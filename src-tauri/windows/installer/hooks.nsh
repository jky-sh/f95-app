; NSIS installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; Tauri's CheckIfAppIsRunning only ends F95 App's own exe. The sidecar
; (sidecar\node.exe) and the Chromium it starts used to outlive it, and
; their open files made the copy fail with "Error opening file for writing
; ... sidecar\node.exe". Since 1.0.2 the app ties them to its lifetime with
; a job object, but an update starts from the version already installed,
; so the installer stops them itself.

; Stops every process whose exe lives in this install's sidecar folder:
; node.exe and Playwright's Chromium. Matching by path leaves the user's
; other node.exe processes alone. The folder goes through the environment
; so nothing in the path can break the PowerShell command; CIM reports
; paths of 64-bit processes to this 32-bit installer.
!macro F95_STOP_SIDECAR
  System::Call 'kernel32::SetEnvironmentVariable(t "F95_SIDECAR_DIR", t "$INSTDIR\sidecar")'
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = $$env:F95_SIDECAR_DIR + '\'; $$p = @(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase) }); $$p | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; if ($$p) { Wait-Process -Id $$p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }"`
  Pop $0
!macroend

; The installer only overwrites the files it ships, so Chromium revisions
; and Playwright files from older versions piled up in sidecar\. The
; bundle.cjs check makes sure the folder is this app's sidecar.
!macro F95_CLEAR_SIDECAR
  ${If} ${FileExists} "$INSTDIR\sidecar\bundle.cjs"
    RMDir /r "$INSTDIR\sidecar"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Close the app first (Tauri's own prompt), or it could start a new
  ; sidecar after the old one is stopped.
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro F95_STOP_SIDECAR
  !insertmacro F95_CLEAR_SIDECAR
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro F95_STOP_SIDECAR
  !insertmacro F95_CLEAR_SIDECAR
!macroend

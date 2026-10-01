//! Opens Big Picture with a controller, also while the app sits in the tray
//! or behind other windows: a thread polls XInput pads for a short press of
//! the Xbox button (Guide) or View + Menu held, brings the main window
//! forward and asks it to open Big Picture (`bigpicture:open-request`).
//!
//! The webview can't do this itself: its Gamepad API only reads pads while
//! the window has focus and, depending on the backend, never reports Guide.
//! XInput keeps reporting to background processes, and the undocumented
//! `XInputGetStateEx` (xinput1_4.dll, ordinal 100) adds the Guide bit.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// Mirrors the Big Picture preferences (`bigpicture_sync_controller`). Off
/// until the main window syncs them after sign-in.
static GUIDE_ENABLED: AtomicBool = AtomicBool::new(false);
static CHORD_ENABLED: AtomicBool = AtomicBool::new(false);

pub const OPEN_REQUEST_EVENT: &str = "bigpicture:open-request";

/// XInput button bits (`XINPUT_GAMEPAD.wButtons`); Guide is only set by the Ex call.
const GUIDE: u16 = 0x0400;
const BACK: u16 = 0x0020; // View
const START: u16 = 0x0010; // Menu
const CHORD: u16 = BACK | START;

/// Held longer, the Xbox button is switching the pad off, not a press.
const GUIDE_TAP_MAX: Duration = Duration::from_millis(1000);
const CHORD_HOLD: Duration = Duration::from_millis(600);
/// One open per gesture, even with two pads or both triggers at once.
const COOLDOWN: Duration = Duration::from_millis(1500);

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Trigger {
    Guide,
    Chord,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl Trigger {
    fn source(self) -> &'static str {
        match self {
            Trigger::Guide => "guide",
            Trigger::Chord => "chord",
        }
    }
}

/// Which triggers are on. Passed in so the state machine stays pure.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, Debug)]
struct Enabled {
    guide: bool,
    chord: bool,
}

/// Press tracking for one pad.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Default)]
struct PadTriggers {
    last: u16,
    guide_down_at: Option<Instant>,
    chord_since: Option<Instant>,
    /// Fired for this hold: waits for View or Menu to be let go.
    chord_latched: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl PadTriggers {
    /// A pad seen for the first time (or again after a pause): what it holds
    /// was pressed before we looked, so it can't fire until released.
    fn seeded(buttons: u16) -> Self {
        Self {
            last: buttons,
            guide_down_at: None,
            chord_since: None,
            chord_latched: buttons & CHORD == CHORD,
        }
    }

    /// A hold is being timed, so the pad needs stepping even without new input.
    fn timing(&self) -> bool {
        self.chord_since.is_some() && !self.chord_latched
    }

    /// The Xbox button goes down with these buttons (checked before `step`).
    fn guide_pressed(&self, buttons: u16) -> bool {
        buttons & !self.last & GUIDE != 0
    }

    fn step(&mut self, buttons: u16, now: Instant, on: Enabled) -> Option<Trigger> {
        let pressed = buttons & !self.last;
        let released = self.last & !buttons;
        self.last = buttons;

        let mut fired = None;
        if pressed & GUIDE != 0 {
            self.guide_down_at = Some(now);
        }
        if released & GUIDE != 0 {
            let tap = self
                .guide_down_at
                .take()
                .is_some_and(|at| now.duration_since(at) < GUIDE_TAP_MAX);
            if tap && on.guide {
                fired = Some(Trigger::Guide);
            }
        }

        // View + Menu and nothing else: with more held it's a game's own combo.
        if buttons & !GUIDE == CHORD {
            let since = *self.chord_since.get_or_insert(now);
            if !self.chord_latched && now.duration_since(since) >= CHORD_HOLD {
                self.chord_latched = true;
                if on.chord && fired.is_none() {
                    fired = Some(Trigger::Chord);
                }
            }
        } else {
            self.chord_since = None;
            if buttons & CHORD != CHORD {
                self.chord_latched = false;
            }
        }
        fired
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Default)]
struct Cooldown {
    last: Option<Instant>,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl Cooldown {
    fn allow(&mut self, now: Instant) -> bool {
        if self.last.is_some_and(|t| now.duration_since(t) < COOLDOWN) {
            return false;
        }
        self.last = Some(now);
        true
    }
}

/// Starts the polling thread (Windows only; a no-op elsewhere).
pub fn start(app: AppHandle) {
    #[cfg(windows)]
    win::start(app);
    #[cfg(not(windows))]
    let _ = app;
}

#[tauri::command]
pub fn bigpicture_sync_controller(guide: bool, chord: bool) {
    GUIDE_ENABLED.store(guide, Ordering::Relaxed);
    CHORD_ENABLED.store(chord, Ordering::Relaxed);
}

/// What Settings needs to explain the controller shortcuts.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerEnv {
    /// The Xbox button can be read (`XInputGetStateEx` was found).
    guide_supported: bool,
    /// Windows opens Xbox Game Bar with the Xbox button as well.
    game_bar_uses_guide: bool,
    /// Steam may react to the Xbox button too ("Guide Button Focuses Steam").
    steam_running: bool,
}

#[tauri::command]
pub async fn bigpicture_controller_env() -> ControllerEnv {
    #[cfg(windows)]
    let env = ControllerEnv {
        guide_supported: win::guide_supported(),
        game_bar_uses_guide: win::game_bar_uses_guide(),
        steam_running: crate::overlay_hotkey::steam_client_running(),
    };
    #[cfg(not(windows))]
    let env = ControllerEnv {
        guide_supported: false,
        game_bar_uses_guide: false,
        steam_running: false,
    };
    env
}

#[cfg(windows)]
mod win {
    use super::{
        Cooldown, Enabled, PadTriggers, Trigger, CHORD_ENABLED, GUIDE_ENABLED, OPEN_REQUEST_EVENT,
    };
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::{s, w, PCSTR};
    use windows::Win32::Foundation::{ERROR_SUCCESS, HWND};
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    use windows::Win32::UI::Input::XboxController::{XINPUT_GAMEPAD, XUSER_MAX_COUNT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GetWindowThreadProcessId, GWL_STYLE, WS_CAPTION,
    };

    const ACTIVE_POLL: Duration = Duration::from_millis(25);
    const IDLE_POLL: Duration = Duration::from_millis(250);
    const OFF_POLL: Duration = Duration::from_millis(500);
    /// Reading an empty slot is slow (Microsoft's advice): look for new pads now and then.
    const PROBE_EMPTY: Duration = Duration::from_secs(2);

    /// `XINPUT_STATE` plus the trailing DWORD `XInputGetStateEx` also writes.
    #[repr(C)]
    #[derive(Default)]
    struct StateEx {
        packet: u32,
        gamepad: XINPUT_GAMEPAD,
        _reserved: u32,
    }

    type GetState = unsafe extern "system" fn(u32, *mut StateEx) -> u32;

    struct XInput {
        get_state: GetState,
        /// The Ex entry point was found, so Guide is reported.
        guide: bool,
    }

    fn xinput() -> Option<&'static XInput> {
        static XINPUT: OnceLock<Option<XInput>> = OnceLock::new();
        XINPUT.get_or_init(load).as_ref()
    }

    fn load() -> Option<XInput> {
        unsafe {
            // Stays loaded for the life of the process.
            let lib = LoadLibraryW(w!("xinput1_4.dll")).ok()?;
            if let Some(ex) = GetProcAddress(lib, PCSTR(100usize as *const u8)) {
                return Some(XInput {
                    get_state: std::mem::transmute::<unsafe extern "system" fn() -> isize, GetState>(ex),
                    guide: true,
                });
            }
            // The plain call writes a smaller struct into the same buffer.
            let plain = GetProcAddress(lib, s!("XInputGetState"))?;
            Some(XInput {
                get_state: std::mem::transmute::<unsafe extern "system" fn() -> isize, GetState>(plain),
                guide: false,
            })
        }
    }

    pub fn guide_supported() -> bool {
        xinput().is_some_and(|x| x.guide)
    }

    /// Packet number and buttons, or None for an empty slot.
    fn read(x: &XInput, slot: u32) -> Option<(u32, u16)> {
        let mut state = StateEx::default();
        // 0 is ERROR_SUCCESS; an empty slot answers ERROR_DEVICE_NOT_CONNECTED.
        let rc = unsafe { (x.get_state)(slot, &mut state) };
        (rc == 0).then(|| (state.packet, state.gamepad.wButtons.0))
    }

    struct Pad {
        packet: u32,
        triggers: PadTriggers,
        /// The window in front when the Xbox button went down.
        guide_fg: Option<isize>,
    }

    pub fn start(app: AppHandle) {
        let spawned = std::thread::Builder::new()
            .name("bp-gamepad".into())
            .spawn(move || run(app));
        if let Err(e) = spawned {
            eprintln!("[big-picture] controller thread failed to start: {e}");
        }
    }

    fn run(app: AppHandle) {
        let Some(x) = xinput() else {
            eprintln!("[big-picture] XInput not available: controller shortcuts are off");
            return;
        };
        let mut pads: [Option<Pad>; XUSER_MAX_COUNT as usize] = Default::default();
        let cooldown = Arc::new(Mutex::new(Cooldown::default()));
        let mut next_probe = Instant::now();
        loop {
            let on = Enabled {
                guide: GUIDE_ENABLED.load(Ordering::Relaxed),
                chord: CHORD_ENABLED.load(Ordering::Relaxed),
            };
            // Off, or nobody signed in yet (no main window): forget the pads,
            // so what they hold when this resumes is seeded again.
            if !(on.guide || on.chord) || app.get_webview_window("main").is_none() {
                pads = Default::default();
                next_probe = Instant::now();
                std::thread::sleep(OFF_POLL);
                continue;
            }

            let now = Instant::now();
            let probe = now >= next_probe;
            if probe {
                next_probe = now + PROBE_EMPTY;
            }
            for (slot, pad) in pads.iter_mut().enumerate() {
                if pad.is_none() && !probe {
                    continue;
                }
                let Some((packet, buttons)) = read(x, slot as u32) else {
                    *pad = None;
                    continue;
                };
                let Some(p) = pad else {
                    *pad = Some(Pad {
                        packet,
                        triggers: PadTriggers::seeded(buttons),
                        guide_fg: None,
                    });
                    continue;
                };
                // Same packet: nothing changed, unless a hold is being timed.
                if packet == p.packet && !p.triggers.timing() {
                    continue;
                }
                p.packet = packet;
                // Noted on the press: by the release, Game Bar or Steam (opened
                // by the same press) may be the window in front.
                if p.triggers.guide_pressed(buttons) {
                    p.guide_fg = crate::game_window::capture_foreground_hwnd();
                }
                if let Some(trigger) = p.triggers.step(buttons, now, on) {
                    let fg = match trigger {
                        Trigger::Guide => p.guide_fg.take(),
                        Trigger::Chord => crate::game_window::capture_foreground_hwnd(),
                    };
                    fire(&app, trigger, fg, now, cooldown.clone());
                }
            }

            let connected = pads.iter().any(Option::is_some);
            std::thread::sleep(if connected { ACTIVE_POLL } else { IDLE_POLL });
        }
    }

    /// `fg` is the window that was in front for this gesture, taken in the
    /// polling thread: by the time the async checks run, focus may have moved.
    fn fire(
        app: &AppHandle,
        trigger: Trigger,
        fg: Option<isize>,
        at: Instant,
        cooldown: Arc<Mutex<Cooldown>>,
    ) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(reason) = suppressed(&app, fg).await {
                eprintln!("[big-picture] {} ignored: {reason}", trigger.source());
                return;
            }
            // Counted only for an open that goes ahead, so an ignored press
            // doesn't swallow a retry.
            if !cooldown.lock().is_ok_and(|mut c| c.allow(at)) {
                return;
            }
            let Some(main) = app.get_webview_window("main") else {
                return;
            };
            // In this order: focusing a hidden or minimized window does nothing.
            let _ = main.show();
            if main.is_minimized().unwrap_or(false) {
                let _ = main.unminimize();
            }
            let _ = main.set_focus();
            let _ = app.emit_to(
                "main",
                OPEN_REQUEST_EVENT,
                serde_json::json!({ "source": trigger.source() }),
            );
        });
    }

    /// Why the controller must be left alone right now, if it must.
    async fn suppressed(app: &AppHandle, fg: Option<isize>) -> Option<&'static str> {
        let Some(main) = app.get_webview_window("main") else {
            return Some("no main window");
        };
        let Some(state) = app.try_state::<crate::commands::AppState>() else {
            return Some("app not ready");
        };
        if crate::commands::overlay::overlay_effective_visible(app, state.inner()) {
            return Some("the game overlay is open");
        }
        if main.is_focused().unwrap_or(false) {
            return None;
        }
        // A game we launched owns the pad until the player comes back to us.
        if !state.launcher.running().await.is_empty() {
            return Some("a game is running");
        }
        if fg.is_some_and(other_app_fullscreen) {
            return Some("another app is fullscreen");
        }
        None
    }

    /// A window of another process covering its whole monitor without a title
    /// bar: a game, a fullscreen video, Steam's own Big Picture.
    fn other_app_fullscreen(raw: isize) -> bool {
        if raw == 0 || crate::game_window::is_shell_desktop_hwnd_raw(raw) {
            return false;
        }
        let hwnd = HWND(raw as _);
        let mut pid = 0u32;
        unsafe {
            let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if pid == 0 || pid == std::process::id() {
            return false;
        }
        // A maximized window covers the screen too when the taskbar auto-hides.
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } as u32;
        if style & WS_CAPTION.0 == WS_CAPTION.0 {
            return false;
        }
        let (Some(win), Some(mon)) = (
            crate::game_window::screen_rect(hwnd),
            crate::game_window::monitor_rect_from_window(hwnd),
        ) else {
            return false;
        };
        win.x <= mon.x
            && win.y <= mon.y
            && win.x + win.width >= mon.x + mon.width
            && win.y + win.height >= mon.y + mon.height
    }

    /// Settings → Gaming → Xbox Game Bar → "Allow your controller to open Game Bar".
    pub fn game_bar_uses_guide() -> bool {
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let rc = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\GameBar"),
                w!("UseNexusForGameBarEnabled"),
                RRF_RT_REG_DWORD,
                None,
                Some(&mut value as *mut u32 as *mut _),
                Some(&mut size),
            )
        };
        // Never set: Windows' default, where the button opens Game Bar.
        rc != ERROR_SUCCESS || value != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ON: Enabled = Enabled { guide: true, chord: true };

    fn ms(base: Instant, n: u64) -> Instant {
        base + Duration::from_millis(n)
    }

    #[test]
    fn guide_tap_fires_on_release() {
        let t = Instant::now();
        let mut pad = PadTriggers::seeded(0);
        assert_eq!(pad.step(GUIDE, t, ON), None);
        assert_eq!(pad.step(0, ms(t, 200), ON), Some(Trigger::Guide));
    }

    #[test]
    fn guide_long_hold_is_not_a_press() {
        let t = Instant::now();
        let mut pad = PadTriggers::seeded(0);
        pad.step(GUIDE, t, ON);
        assert_eq!(pad.step(GUIDE, ms(t, 1500), ON), None);
        assert_eq!(pad.step(0, ms(t, 2000), ON), None);
    }

    #[test]
    fn guide_held_on_connect_is_ignored() {
        let t = Instant::now();
        let mut pad = PadTriggers::seeded(GUIDE);
        assert_eq!(pad.step(0, ms(t, 100), ON), None);
        pad.step(GUIDE, ms(t, 300), ON);
        assert_eq!(pad.step(0, ms(t, 400), ON), Some(Trigger::Guide));
    }

    #[test]
    fn guide_press_edge_is_seen_once() {
        let t = Instant::now();
        let mut pad = PadTriggers::seeded(GUIDE);
        // Held since before we looked: not a press.
        assert!(!pad.guide_pressed(GUIDE));
        pad.step(0, t, ON);
        assert!(pad.guide_pressed(GUIDE | BACK));
        pad.step(GUIDE, ms(t, 50), ON);
        assert!(!pad.guide_pressed(GUIDE));
        assert!(!pad.guide_pressed(0));
    }

    #[test]
    fn chord_fires_once_after_the_hold() {
        let t = Instant::now();
        let mut pad = PadTriggers::seeded(0);
        assert_eq!(pad.step(BACK, t, ON), None);
        assert_eq!(pad.step(CHORD, ms(t, 50), ON), None);
        assert!(pad.timing());
        assert_eq!(pad.step(CHORD, ms(t, 500), ON), None);
        assert_eq!(pad.step(CHORD, ms(t, 660), ON), Some(Trigger::Chord));
        assert!(!pad.timing());
        assert_eq!(pad.step(CHORD, ms(t, 2000), ON), None);
    }

    #[test]
    fn chord_short_tap_does_nothing() {
        let t = Instant::now();
        let mut pad = PadTriggers::seeded(0);
        pad.step(CHORD, t, ON);
        assert_eq!(pad.step(0, ms(t, 300), ON), None);
        assert_eq!(pad.step(0, ms(t, 900), ON), None);
    }

    #[test]
    fn chord_with_other_buttons_is_a_game_combo() {
        let t = Instant::now();
        let a = 0x1000;
        let mut pad = PadTriggers::seeded(0);
        pad.step(CHORD | a, t, ON);
        assert_eq!(pad.step(CHORD | a, ms(t, 800), ON), None);
        // Letting go of the extra button starts the hold over.
        assert_eq!(pad.step(CHORD, ms(t, 900), ON), None);
        assert_eq!(pad.step(CHORD, ms(t, 1300), ON), None);
        assert_eq!(pad.step(CHORD, ms(t, 1500), ON), Some(Trigger::Chord));
    }

    #[test]
    fn chord_held_on_connect_waits_for_release() {
        let t = Instant::now();
        let mut pad = PadTriggers::seeded(CHORD);
        assert_eq!(pad.step(CHORD, ms(t, 100), ON), None);
        assert_eq!(pad.step(CHORD, ms(t, 2000), ON), None);
        pad.step(BACK, ms(t, 2100), ON);
        pad.step(CHORD, ms(t, 2200), ON);
        assert_eq!(pad.step(CHORD, ms(t, 2850), ON), Some(Trigger::Chord));
    }

    #[test]
    fn disabled_triggers_stay_quiet() {
        let t = Instant::now();
        let off = Enabled { guide: false, chord: false };
        let mut pad = PadTriggers::seeded(0);
        pad.step(GUIDE, t, off);
        assert_eq!(pad.step(0, ms(t, 100), off), None);
        pad.step(CHORD, ms(t, 200), off);
        assert_eq!(pad.step(CHORD, ms(t, 900), off), None);
        // Turned on mid-hold: this hold already counted, so no surprise open.
        assert_eq!(pad.step(CHORD, ms(t, 1000), ON), None);
    }

    #[test]
    fn cooldown_spaces_out_opens() {
        let t = Instant::now();
        let mut cd = Cooldown::default();
        assert!(cd.allow(t));
        assert!(!cd.allow(ms(t, 1000)));
        assert!(cd.allow(ms(t, 1600)));
    }
}

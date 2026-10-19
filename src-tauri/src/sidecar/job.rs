//! Ties the sidecar's process tree to the app's lifetime (Windows).
//!
//! node.exe and the Chromium it starts outlived the app whenever it didn't
//! leave through `RunEvent::Exit`: the installer killing it before an
//! update, a crash, Task Manager. They keep their files open, so the next
//! install failed with "Error opening file for writing ... sidecar\node.exe".
//! A job object with KILL_ON_JOB_CLOSE ends the whole tree when its last
//! handle closes, and Windows closes it when the app process dies, however
//! it dies.

use std::ffi::c_void;
use std::os::windows::io::RawHandle;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct ProcessJob(HANDLE);

// The handle is only used with kernel calls that are safe from any thread.
unsafe impl Send for ProcessJob {}
unsafe impl Sync for ProcessJob {}

impl ProcessJob {
    /// Puts `process` in a new job. Processes it starts later join the job
    /// too, so Playwright's Chromium is covered.
    pub fn adopt(process: RawHandle) -> windows::core::Result<Self> {
        unsafe {
            let job = Self(CreateJobObjectW(None, PCWSTR::null())?);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )?;
            AssignProcessToJobObject(job.0, HANDLE(process))?;
            Ok(job)
        }
    }

    /// Ends every process in the job now.
    pub fn terminate(&self) {
        unsafe {
            let _ = TerminateJobObject(self.0, 1);
        }
    }
}

impl Drop for ProcessJob {
    fn drop(&mut self) {
        // Closing the last handle kills whatever is still in the job.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::os::windows::io::AsRawHandle;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    /// cmd.exe starts ping.exe; both write to the same pipe, so the pipe
    /// reaches EOF only once the child AND the grandchild are gone.
    fn spawn_tree() -> std::process::Child {
        Command::new("cmd")
            .args(["/c", "ping -n 30 127.0.0.1"])
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn cmd")
    }

    fn tree_exits_within(mut child: std::process::Child, wait: Duration) -> bool {
        let mut stdout = child.stdout.take().expect("stdout");
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = stdout.read_to_end(&mut sink);
            let _ = tx.send(());
        });
        let exited = rx.recv_timeout(wait).is_ok();
        let _ = child.kill();
        exited
    }

    #[test]
    fn closing_the_job_kills_the_whole_tree() {
        let child = spawn_tree();
        let job = ProcessJob::adopt(child.as_raw_handle()).expect("adopt");
        // Let cmd start ping inside the job.
        std::thread::sleep(Duration::from_millis(500));
        drop(job);
        assert!(tree_exits_within(child, Duration::from_secs(5)));
    }

    #[test]
    fn terminate_kills_the_whole_tree() {
        let child = spawn_tree();
        let job = ProcessJob::adopt(child.as_raw_handle()).expect("adopt");
        std::thread::sleep(Duration::from_millis(500));
        job.terminate();
        assert!(tree_exits_within(child, Duration::from_secs(5)));
    }
}

#[cfg(windows)]
pub(crate) mod job;
mod path;
mod rpc;
mod service;

pub use path::resolve_sidecar_path;
pub use rpc::{HostResolveResult, SessionCookie, SidecarClient, UnmaskResult};
pub use service::{block_starts, ensure, kill};

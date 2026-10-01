//! Background download manager and per-host resolvers.

pub(crate) mod gofile_pick;
pub(crate) mod host;
mod manager;
mod platform;
mod resolvers;
mod stream;
mod types;
mod util;
pub(crate) mod verify;

pub use manager::{GoFileCreds, Manager};
pub(crate) use types::ResolveResult;

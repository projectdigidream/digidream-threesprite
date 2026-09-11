use tauri::ipc::{InvokeBody, Request, Response};

use crate::error::{Error, Result};

#[tauri::command]
pub fn ping() -> String {
    format!("pong from {} {}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Raw-body round trip used by the smoke test: proves that a `Uint8Array`
/// passed to `invoke` arrives as `InvokeBody::Raw` and that a `Response` of
/// bytes comes back as an `ArrayBuffer`, on every platform.
#[tauri::command]
pub fn echo_bytes(request: Request<'_>) -> Result<Response> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(Response::new(bytes.clone())),
        InvokeBody::Json(_) => Err(Error::BadRequest("expected a raw binary body".into())),
    }
}

use serde::Serialize;

/// Every command error crosses the IPC boundary as a plain message string.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("{0}")]
    Other(String),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<png::EncodingError> for Error {
    fn from(e: png::EncodingError) -> Self { Error::Other(format!("png encode: {e}")) }
}
impl From<png::DecodingError> for Error {
    fn from(e: png::DecodingError) -> Self { Error::Other(format!("png decode: {e}")) }
}
impl From<gif::EncodingError> for Error {
    fn from(e: gif::EncodingError) -> Self { Error::Other(format!("gif encode: {e}")) }
}
impl From<zip::result::ZipError> for Error {
    fn from(e: zip::result::ZipError) -> Self { Error::Other(format!("zip: {e}")) }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self { Error::BadRequest(format!("json: {e}")) }
}
impl From<url::ParseError> for Error {
    fn from(e: url::ParseError) -> Self { Error::BadRequest(format!("url: {e}")) }
}

pub type Result<T> = std::result::Result<T, Error>;

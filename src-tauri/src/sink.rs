//! Where export files go: a directory, or a zip written to a path or (on
//! Android) to a Storage Access Framework `content://` URI. The zip is built
//! in memory and written in one go, because SAF file descriptors are not
//! guaranteed to be seekable.
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

use crate::bundle::SinkSpec;
use crate::error::{Error, Result};

pub struct Written {
    pub files: Vec<String>,
    pub bytes: u64,
    pub location: String,
}

pub fn write_all(app: &AppHandle, spec: &SinkSpec, files: &[(String, Vec<u8>)]) -> Result<Written> {
    match spec {
        SinkSpec::Dir { path } => write_dir(Path::new(path), files),
        SinkSpec::Zip { path, content_uri } => {
            let zip = build_zip(files)?;
            let bytes = zip.len() as u64;
            let location = if let Some(p) = path {
                let p = PathBuf::from(p);
                if let Some(parent) = p.parent() {
                    if !parent.as_os_str().is_empty() {
                        std::fs::create_dir_all(parent)?;
                    }
                }
                std::fs::write(&p, &zip)?;
                p.to_string_lossy().into_owned()
            } else if let Some(uri) = content_uri {
                let url = url::Url::parse(uri)?;
                let mut opts = OpenOptions::new();
                opts.write(true).create(true).truncate(true);
                let mut f = app
                    .fs()
                    .open(FilePath::Url(url), opts)
                    .map_err(|e| Error::Other(format!("open {uri}: {e}")))?;
                f.write_all(&zip)?;
                f.flush()?;
                uri.clone()
            } else {
                return Err(Error::BadRequest("zip sink needs a path or a contentUri".into()));
            };
            Ok(Written { files: files.iter().map(|(n, _)| n.clone()).collect(), bytes, location })
        }
    }
}

fn write_dir(dir: &Path, files: &[(String, Vec<u8>)]) -> Result<Written> {
    std::fs::create_dir_all(dir)?;
    let mut out = Vec::with_capacity(files.len());
    let mut bytes = 0u64;
    for (name, data) in files {
        if name.contains("..") || name.starts_with('/') {
            return Err(Error::BadRequest(format!("refusing to write outside the export folder: {name}")));
        }
        let p = dir.join(name);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&p, data)?;
        bytes += data.len() as u64;
        out.push(p.to_string_lossy().into_owned());
    }
    Ok(Written { files: out, bytes, location: dir.to_string_lossy().into_owned() })
}

pub fn build_zip(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>> {
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in files {
        w.start_file(name.as_str(), opts)?;
        w.write_all(data)?;
    }
    Ok(w.finish()?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_round_trip() {
        let files = vec![("a/b.txt".to_string(), b"hello".to_vec()), ("c.bin".to_string(), vec![0u8; 100])];
        let z = build_zip(&files).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(z)).unwrap();
        assert_eq!(archive.len(), 2);
        let mut f = archive.by_name("a/b.txt").unwrap();
        let mut s = String::new();
        std::io::Read::read_to_string(&mut f, &mut s).unwrap();
        assert_eq!(s, "hello");
    }

    #[test]
    fn dir_write_refuses_escapes() {
        let tmp = std::env::temp_dir().join(format!("threesprite-sink-{}", std::process::id()));
        let r = write_dir(&tmp, &[("../x.txt".to_string(), vec![1])]);
        assert!(r.is_err());
        let ok = write_dir(&tmp, &[("sub/y.txt".to_string(), vec![1, 2, 3])]).unwrap();
        assert_eq!(ok.bytes, 3);
        assert!(tmp.join("sub/y.txt").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

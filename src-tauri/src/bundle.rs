//! The export bundle the frontend sends over raw IPC:
//! `u32le manifest_len | manifest JSON | frame_0 RGBA | frame_1 RGBA | …`
//! Every frame is `canvas × canvas × 4` bytes, in `manifest.frames` order.
use serde::Deserialize;

use crate::error::{Error, Result};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnimationMeta {
    pub name: String,
    pub fps: f64,
    #[serde(rename = "loop")]
    pub looping: bool,
    pub frame_count: u32,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FrameRef {
    pub anim: usize,
    pub frame: u32,
    pub view: u32,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SinkSpec {
    Dir { path: String },
    Zip {
        #[serde(default)]
        path: Option<String>,
        #[serde(default, rename = "contentUri")]
        content_uri: Option<String>,
    },
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    /// Doom-style naming with a view count other than 1/8/16: export view 1 only, as rotation 0.
    #[serde(default)]
    pub doom_front_only: bool,
    /// Round the atlas height up to a power of two.
    #[serde(default)]
    pub atlas_pow2: bool,
    #[serde(default = "default_turntable_fps")]
    pub turntable_fps: f64,
}

fn default_turntable_fps() -> f64 { 4.0 }

impl Default for Options {
    fn default() -> Self { Self { doom_front_only: false, atlas_pow2: false, turntable_fps: 4.0 } }
}

#[derive(Deserialize, Clone, Debug)]
pub struct Views {
    pub count: u32,
    pub mirror: bool,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub sink: SinkSpec,
    pub sprite: String,
    pub canvas: u32,
    pub views: Views,
    #[serde(default = "one")]
    pub world_height: f64,
    pub animations: Vec<AnimationMeta>,
    pub frames: Vec<FrameRef>,
    #[serde(default)]
    pub options: Options,
}

fn one() -> f64 { 1.0 }

pub struct Bundle<'a> {
    pub manifest: Manifest,
    pub frames: Vec<&'a [u8]>,
}

impl<'a> Bundle<'a> {
    /// RGBA of a frame by reference, if the bundle carries it.
    pub fn frame(&self, anim: usize, frame: u32, view: u32) -> Option<&'a [u8]> {
        self.manifest
            .frames
            .iter()
            .position(|f| f.anim == anim && f.frame == frame && f.view == view)
            .map(|i| self.frames[i])
    }
}

pub fn parse(body: &[u8]) -> Result<Bundle<'_>> {
    if body.len() < 4 {
        return Err(Error::BadRequest("bundle too short".into()));
    }
    let len = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if body.len() < 4 + len {
        return Err(Error::BadRequest("bundle manifest truncated".into()));
    }
    let manifest: Manifest = serde_json::from_slice(&body[4..4 + len])?;
    if manifest.canvas == 0 || manifest.canvas > 4096 {
        return Err(Error::BadRequest(format!("bad canvas size {}", manifest.canvas)));
    }
    let stride = (manifest.canvas * manifest.canvas * 4) as usize;
    let rest = &body[4 + len..];
    if rest.len() != stride * manifest.frames.len() {
        return Err(Error::BadRequest(format!(
            "expected {} frames of {} bytes ({}), got {} bytes",
            manifest.frames.len(),
            stride,
            stride * manifest.frames.len(),
            rest.len()
        )));
    }
    for f in &manifest.frames {
        if f.anim >= manifest.animations.len() {
            return Err(Error::BadRequest(format!("frame refers to missing animation {}", f.anim)));
        }
        if f.view == 0 || f.view > manifest.views.count {
            return Err(Error::BadRequest(format!("frame refers to view {} of {}", f.view, manifest.views.count)));
        }
    }
    let frames = rest.chunks_exact(stride).collect();
    Ok(Bundle { manifest, frames })
}

/// Safe file-name fragment for an animation name.
pub fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if s.is_empty() { "anim".into() } else { s }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn make_body(manifest: &str, frames: &[Vec<u8>]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
        out.extend_from_slice(manifest.as_bytes());
        for f in frames {
            out.extend_from_slice(f);
        }
        out
    }

    #[test]
    fn parses_and_validates() {
        let m = r#"{"format":"pngs","sink":{"kind":"dir","path":"/tmp/x"},"sprite":"TSPR","canvas":2,"views":{"count":1,"mirror":false},"animations":[{"name":"idle","fps":8,"loop":true,"frameCount":1}],"frames":[{"anim":0,"frame":0,"view":1}]}"#;
        let body = make_body(m, &[vec![1u8; 16]]);
        let b = parse(&body).unwrap();
        assert_eq!(b.frames.len(), 1);
        assert_eq!(b.frame(0, 0, 1).unwrap().len(), 16);
        assert!(b.frame(0, 0, 2).is_none());
        let bad = make_body(m, &[vec![1u8; 15]]);
        assert!(parse(&bad).is_err());
        let m2 = m.replace(r#""view":1"#, r#""view":2"#);
        assert!(parse(&make_body(&m2, &[vec![1u8; 16]])).is_err());
    }

    #[test]
    fn slug_is_filename_safe() {
        assert_eq!(slug("walk cycle/2"), "walk_cycle_2");
        assert_eq!(slug(""), "anim");
    }
}

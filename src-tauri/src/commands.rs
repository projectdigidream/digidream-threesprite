use std::borrow::Cow;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::AppHandle;

use crate::bundle::{self, slug, Bundle};
use crate::error::{Error, Result};
use crate::{atlas, doom, gif_codec, png_codec, sink};

#[tauri::command]
pub fn ping() -> String {
    format!("pong from {} {}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Whether the process was started with `THREESPRITE_SELFTEST=1` (desktop automation).
#[tauri::command]
pub fn selftest_flag() -> bool {
    std::env::var("THREESPRITE_SELFTEST").map(|v| v == "1").unwrap_or(false)
}

/// The self-test reports here; the line is printed for the launcher (stdout on
/// desktop, logcat on Android) and the app exits when it was started for it.
#[tauri::command]
pub fn selftest_done(app: AppHandle, report: String) {
    println!("SELFTEST {report}");
    if selftest_flag() {
        app.exit(0);
    }
}

/// Binary round trip used by the self-test. Desktop sends a raw body and gets
/// raw bytes back; mobile (where the IPC bridge is JSON-only) sends
/// `{ "b64": … }` and gets `{ "b64": … }` back.
#[tauri::command]
pub fn echo_bytes(request: Request<'_>) -> Result<Response> {
    let was_raw = matches!(request.body(), InvokeBody::Raw(_));
    let bytes = body_bytes(&request)?;
    if was_raw {
        Ok(Response::new(bytes.into_owned()))
    } else {
        Ok(Response::new(serde_json::json!({ "b64": B64.encode(bytes.as_ref()) }).to_string()))
    }
}

/// `u32le w | u32le h | RGBA` → PNG bytes (raw or `{ "b64": … }` like `echo_bytes`).
#[tauri::command]
pub fn encode_png(request: Request<'_>) -> Result<Response> {
    let was_raw = matches!(request.body(), InvokeBody::Raw(_));
    let body = body_bytes(&request)?;
    if body.len() < 8 {
        return Err(Error::BadRequest("encode_png: body too short".into()));
    }
    let w = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
    let h = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
    let png = png_codec::encode_rgba(w, h, &body[8..])?;
    if was_raw {
        Ok(Response::new(png))
    } else {
        Ok(Response::new(serde_json::json!({ "b64": B64.encode(&png) }).to_string()))
    }
}

#[derive(Serialize)]
pub struct ExportReport {
    pub files: Vec<String>,
    pub warnings: Vec<String>,
    pub bytes: u64,
    pub location: String,
}

/// The export pipeline: parse the bundle, produce files for the requested
/// format, write them to the sink.
#[tauri::command]
pub fn export_bundle(app: AppHandle, request: Request<'_>) -> Result<ExportReport> {
    let body = body_bytes(&request)?;
    let bundle = bundle::parse(&body)?;
    let mut warnings = Vec::new();
    let files = produce(&bundle, &mut warnings)?;
    if files.is_empty() {
        return Err(Error::BadRequest("nothing to export (no animations selected?)".into()));
    }
    let written = sink::write_all(&app, &bundle.manifest.sink, &files)?;
    Ok(ExportReport { files: written.files, warnings, bytes: written.bytes, location: written.location })
}

#[derive(Serialize)]
pub struct DirInfo {
    pub exists: bool,
    pub writable: bool,
    pub entries: usize,
}

#[tauri::command]
pub fn probe_dir(path: String) -> Result<DirInfo> {
    let p = std::path::Path::new(&path);
    let exists = p.is_dir();
    let entries = if exists { std::fs::read_dir(p).map(|d| d.count()).unwrap_or(0) } else { 0 };
    let writable = if exists {
        !std::fs::metadata(p).map(|m| m.permissions().readonly()).unwrap_or(true)
    } else {
        p.parent().map(|pp| pp.is_dir()).unwrap_or(false)
    };
    Ok(DirInfo { exists, writable, entries })
}

/// The binary payload of a command, whichever way the platform's IPC bridge
/// delivered it: a raw body (desktop), `{ "b64": "…" }` (mobile), or a JSON
/// array of byte values.
fn body_bytes<'a>(request: &'a Request<'_>) -> Result<Cow<'a, [u8]>> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(Cow::Borrowed(bytes.as_slice())),
        InvokeBody::Json(v) => {
            if let Some(s) = v.get("b64").and_then(|x| x.as_str()) {
                return B64.decode(s).map(Cow::Owned).map_err(|e| Error::BadRequest(format!("base64: {e}")));
            }
            if let Some(arr) = v.as_array() {
                let mut out = Vec::with_capacity(arr.len());
                for x in arr {
                    out.push(x.as_u64().ok_or_else(|| Error::BadRequest("byte array element is not a number".into()))? as u8);
                }
                return Ok(Cow::Owned(out));
            }
            Err(Error::BadRequest("expected a raw binary body, { b64 } or a byte array".into()))
        }
    }
}

/// Files (name, bytes) for a bundle. Pure; shared by the command and the tests.
pub fn produce(b: &Bundle<'_>, warnings: &mut Vec<String>) -> Result<Vec<(String, Vec<u8>)>> {
    match b.manifest.format.as_str() {
        "doom" => produce_doom(b, warnings),
        "pngs" => produce_pngs(b),
        "atlas" => produce_atlas(b, warnings),
        "gif" => produce_gif(b, warnings),
        other => Err(Error::BadRequest(format!("unknown export format \"{other}\""))),
    }
}

fn produce_doom(b: &Bundle<'_>, warnings: &mut Vec<String>) -> Result<Vec<(String, Vec<u8>)>> {
    let m = &b.manifest;
    doom::validate_sprite_name(&m.sprite)?;
    let n = m.views.count;
    let front_only = !doom::supports_view_count(n);
    if front_only && !m.options.doom_front_only {
        return Err(Error::BadRequest(format!(
            "Doom-style naming supports 1, 8 or 16 views; this sprite has {n}. Enable \"front view only\" to export view 1 as rotation 0."
        )));
    }
    if front_only {
        warnings.push(format!("{n} views cannot be named Doom-style; only view 1 was exported, as rotation 0"));
    }
    let total: u32 = m.animations.iter().map(|a| a.frame_count).sum();
    if total > 26 {
        return Err(Error::BadRequest(format!(
            "Doom-style naming supports at most 26 frames per sprite (A–Z); the selected animations have {total}"
        )));
    }
    let mut out = Vec::new();
    let mut letter_index = 0u32;
    for (ai, anim) in m.animations.iter().enumerate() {
        for fi in 0..anim.frame_count {
            let letter = doom::frame_letter(letter_index)?;
            letter_index += 1;
            let views: Vec<u32> = if front_only { vec![1] } else { (1..=n).collect() };
            for v in views {
                let Some(rgba) = b.frame(ai, fi, v) else {
                    warnings.push(format!("{}: frame {} view {} missing from the bundle", anim.name, fi + 1, v));
                    continue;
                };
                let rot = if front_only { '0' } else { doom::rotation_char(n, v)? };
                let name = format!("{}.png", doom::lump_name(&m.sprite, letter, rot));
                out.push((name, png_codec::encode_rgba(m.canvas, m.canvas, rgba)?));
            }
        }
    }
    if let Some(bad) = b.frames.iter().position(|f| bottom_row_transparent(f, m.canvas)) {
        if b.frames.iter().all(|f| bottom_row_transparent(f, m.canvas)) {
            let _ = bad;
            warnings.push("No frame touches the bottom row; engines that anchor sprites at the feet will float this sprite above the ground".into());
        }
    }
    Ok(out)
}

fn bottom_row_transparent(rgba: &[u8], n: u32) -> bool {
    let row = ((n - 1) * n * 4) as usize;
    rgba[row..row + (n * 4) as usize].chunks_exact(4).all(|px| px[3] == 0)
}

fn produce_pngs(b: &Bundle<'_>) -> Result<Vec<(String, Vec<u8>)>> {
    let m = &b.manifest;
    let mut out = Vec::new();
    for (i, fr) in m.frames.iter().enumerate() {
        let name = format!("{}/{}/{:03}_v{:02}.png", m.sprite, slug(&m.animations[fr.anim].name), fr.frame, fr.view);
        out.push((name, png_codec::encode_rgba(m.canvas, m.canvas, b.frames[i])?));
    }
    Ok(out)
}

fn produce_atlas(b: &Bundle<'_>, warnings: &mut Vec<String>) -> Result<Vec<(String, Vec<u8>)>> {
    let (png, json) = atlas::build(b, warnings)?;
    let m = &b.manifest;
    Ok(vec![(format!("{}.png", m.sprite), png), (format!("{}.json", m.sprite), json.into_bytes())])
}

fn produce_gif(b: &Bundle<'_>, warnings: &mut Vec<String>) -> Result<Vec<(String, Vec<u8>)>> {
    let m = &b.manifest;
    let n = m.canvas;
    let mut out = Vec::new();
    for (ai, anim) in m.animations.iter().enumerate() {
        let delay = gif_codec::delay_for_fps(anim.fps, warnings, &anim.name);
        for v in 1..=m.views.count {
            let frames: Vec<&[u8]> = (0..anim.frame_count).filter_map(|fi| b.frame(ai, fi, v)).collect();
            if frames.is_empty() {
                continue;
            }
            let frames = if anim.fps > 0.0 { frames } else { vec![frames[0]] };
            let gif = gif_codec::encode(&frames, n, n, &gif_codec::GifOptions { delays_cs: vec![delay], repeat: anim.looping }, warnings)?;
            out.push((format!("{}_{}_v{:02}.gif", m.sprite, slug(&anim.name), v), gif));
        }
    }
    // turntable: frame 0 of the first animation, cycling every view
    if let Some(first) = m.animations.first() {
        let frames: Vec<&[u8]> = (1..=m.views.count).filter_map(|v| b.frame(0, 0, v)).collect();
        if frames.len() > 1 {
            let delay = gif_codec::delay_for_fps(m.options.turntable_fps, warnings, "turntable");
            let gif = gif_codec::encode(&frames, n, n, &gif_codec::GifOptions { delays_cs: vec![delay], repeat: true }, warnings)?;
            out.push((format!("{}_turntable.gif", m.sprite), gif));
            let _ = first;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle_body(format: &str, views: u32, anims: &[(&str, u32)], extra_opts: &str) -> Vec<u8> {
        let n = 4u32;
        let mut frames_json = Vec::new();
        let mut frames = Vec::new();
        for (ai, (_, fc)) in anims.iter().enumerate() {
            for fi in 0..*fc {
                for v in 1..=views {
                    frames_json.push(format!(r#"{{"anim":{ai},"frame":{fi},"view":{v}}}"#));
                    let mut px = vec![0u8; (n * n * 4) as usize];
                    // one opaque pixel whose position encodes (frame, view), on the bottom row
                    let x = (fi + v) % n;
                    let i = (((n - 1) * n + x) * 4) as usize;
                    px[i] = 255;
                    px[i + 1] = (v * 10) as u8;
                    px[i + 3] = 255;
                    frames.push(px);
                }
            }
        }
        let anims_json: Vec<String> = anims.iter().map(|(name, fc)| format!(r#"{{"name":"{name}","fps":8,"loop":true,"frameCount":{fc}}}"#)).collect();
        let manifest = format!(
            r#"{{"format":"{format}","sink":{{"kind":"dir","path":"/tmp/unused"}},"sprite":"TSPR","canvas":{n},"views":{{"count":{views},"mirror":false}},"animations":[{}],"frames":[{}],"options":{{{extra_opts}}}}}"#,
            anims_json.join(","),
            frames_json.join(",")
        );
        let mut body = Vec::new();
        body.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
        body.extend_from_slice(manifest.as_bytes());
        for f in &frames {
            body.extend_from_slice(f);
        }
        body
    }

    #[test]
    fn doom_names_and_letters_span_animations() {
        let body = bundle_body("doom", 8, &[("walk", 2), ("die", 1)], "");
        let b = bundle::parse(&body).unwrap();
        let mut w = Vec::new();
        let files = produce(&b, &mut w).unwrap();
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names.len(), 24);
        assert_eq!(names[0], "TSPRA1.png");
        assert_eq!(names[7], "TSPRA8.png");
        assert_eq!(names[8], "TSPRB1.png");
        assert_eq!(names[16], "TSPRC1.png");
        let (w2, h2, px) = png_codec::decode_rgba(&files[2].1).unwrap();
        assert_eq!((w2, h2), (4, 4));
        assert_eq!(px[((3 * 4 + 3) * 4) as usize], 255); // frame 0, view 3 → x = 3
        assert!(w.is_empty());
    }

    #[test]
    fn doom_rejects_unsupported_view_counts_unless_front_only() {
        let body = bundle_body("doom", 6, &[("idle", 1)], "");
        let b = bundle::parse(&body).unwrap();
        assert!(produce(&b, &mut Vec::new()).is_err());
        let body = bundle_body("doom", 6, &[("idle", 1)], r#""doomFrontOnly":true"#);
        let b = bundle::parse(&body).unwrap();
        let mut w = Vec::new();
        let files = produce(&b, &mut w).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, "TSPRA0.png");
        assert_eq!(w.len(), 1);
    }

    #[test]
    fn doom_rejects_more_than_26_frames() {
        let body = bundle_body("doom", 1, &[("a", 20), ("b", 7)], "");
        let b = bundle::parse(&body).unwrap();
        assert!(produce(&b, &mut Vec::new()).is_err());
    }

    #[test]
    fn pngs_atlas_gif_produce_files() {
        let body = bundle_body("pngs", 4, &[("walk", 2)], "");
        let b = bundle::parse(&body).unwrap();
        let files = produce(&b, &mut Vec::new()).unwrap();
        assert_eq!(files.len(), 8);
        assert_eq!(files[0].0, "TSPR/walk/000_v01.png");
        assert_eq!(files[7].0, "TSPR/walk/001_v04.png");

        let body = bundle_body("atlas", 4, &[("walk", 2)], r#""atlasPow2":true"#);
        let b = bundle::parse(&body).unwrap();
        let mut w = Vec::new();
        let files = produce(&b, &mut w).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].0, "TSPR.png");
        let manifest: serde_json::Value = serde_json::from_slice(&files[1].1).unwrap();
        assert_eq!(manifest["views"]["count"], 4);
        assert_eq!(manifest["frames"].as_object().unwrap().len(), 8);
        assert_eq!(manifest["animations"][0]["frames"][1]["views"]["3"], "walk/1/v3");
        let (aw, ah, _) = png_codec::decode_rgba(&files[0].1).unwrap();
        assert_eq!((aw, ah), (manifest["size"]["w"].as_u64().unwrap() as u32, manifest["size"]["h"].as_u64().unwrap() as u32));

        let body = bundle_body("gif", 4, &[("walk", 2)], "");
        let b = bundle::parse(&body).unwrap();
        let mut w = Vec::new();
        let files = produce(&b, &mut w).unwrap();
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["TSPR_walk_v01.gif", "TSPR_walk_v02.gif", "TSPR_walk_v03.gif", "TSPR_walk_v04.gif", "TSPR_turntable.gif"]);
    }
}

//! Trim + shelf-pack frames into one sheet, with a JSON manifest describing
//! rects, pivots, animations and view angles.
use serde::Serialize;

use crate::bundle::{slug, Bundle};
use crate::error::Result;
use crate::png_codec;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Bounding box of pixels with alpha > 0, or None when fully transparent.
pub fn opaque_bounds(rgba: &[u8], w: u32, h: u32) -> Option<Rect> {
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0i64, 0i64);
    let mut any = false;
    for y in 0..h {
        for x in 0..w {
            if rgba[((y * w + x) * 4 + 3) as usize] != 0 {
                any = true;
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x as i64);
                y1 = y1.max(y as i64);
            }
        }
    }
    if !any {
        return None;
    }
    Some(Rect { x: x0, y: y0, w: (x1 as u32 - x0) + 1, h: (y1 as u32 - y0) + 1 })
}

pub fn next_pow2(n: u32) -> u32 {
    let mut p = 1;
    while p < n {
        p <<= 1;
    }
    p
}

/// Shelf packing: sort by height (desc), fill rows left to right. Returns
/// positions in input order plus the sheet size.
pub fn pack(sizes: &[(u32, u32)], padding: u32, pow2_height: bool) -> (Vec<(u32, u32)>, u32, u32) {
    if sizes.is_empty() {
        return (vec![], 1, 1);
    }
    let area: u64 = sizes.iter().map(|(w, h)| ((w + padding) * (h + padding)) as u64).sum();
    let max_w = sizes.iter().map(|(w, _)| w + padding).max().unwrap_or(1);
    let width = next_pow2(((area as f64 * 1.15).sqrt().ceil() as u32).max(max_w)).max(1);
    let mut order: Vec<usize> = (0..sizes.len()).collect();
    order.sort_by(|&a, &b| sizes[b].1.cmp(&sizes[a].1).then(sizes[b].0.cmp(&sizes[a].0)).then(a.cmp(&b)));
    let mut pos = vec![(0u32, 0u32); sizes.len()];
    let (mut x, mut y, mut shelf_h) = (padding, padding, 0u32);
    for i in order {
        let (w, h) = sizes[i];
        if x + w + padding > width {
            x = padding;
            y += shelf_h + padding;
            shelf_h = 0;
        }
        pos[i] = (x, y);
        x += w + padding;
        shelf_h = shelf_h.max(h);
    }
    let mut height = y + shelf_h + padding;
    if pow2_height {
        height = next_pow2(height);
    }
    (pos, width, height.max(1))
}

#[derive(Serialize)]
struct ViewMeta {
    index: u32,
    #[serde(rename = "angleDeg")]
    angle_deg: f64,
    mirrored: bool,
    #[serde(rename = "mirrorOf")]
    mirror_of: Option<u32>,
}

#[derive(Serialize)]
struct FrameMeta {
    rect: Rect,
    source: Rect,
    pivot: Pivot,
}

#[derive(Serialize)]
struct Pivot {
    x: f64,
    y: f64,
}

pub fn build(bundle: &Bundle<'_>, warnings: &mut Vec<String>) -> Result<(Vec<u8>, String)> {
    let m = &bundle.manifest;
    let n = m.canvas;
    let padding = 1;

    // trim each frame; empty frames get a 1×1 transparent slot
    let mut trims: Vec<Rect> = Vec::with_capacity(bundle.frames.len());
    for (i, f) in bundle.frames.iter().enumerate() {
        match opaque_bounds(f, n, n) {
            Some(r) => trims.push(r),
            None => {
                let fr = m.frames[i];
                warnings.push(format!("{}: frame {} view {} is empty", m.animations[fr.anim].name, fr.frame + 1, fr.view));
                trims.push(Rect { x: 0, y: 0, w: 1, h: 1 });
            }
        }
    }
    let sizes: Vec<(u32, u32)> = trims.iter().map(|r| (r.w, r.h)).collect();
    let (pos, width, height) = pack(&sizes, padding, m.options.atlas_pow2);

    // blit
    let mut sheet = vec![0u8; (width * height * 4) as usize];
    for (i, f) in bundle.frames.iter().enumerate() {
        let t = trims[i];
        let (px, py) = pos[i];
        if opaque_bounds(f, n, n).is_none() {
            continue;
        }
        for y in 0..t.h {
            let src = (((t.y + y) * n + t.x) * 4) as usize;
            let dst = (((py + y) * width + px) * 4) as usize;
            sheet[dst..dst + (t.w * 4) as usize].copy_from_slice(&f[src..src + (t.w * 4) as usize]);
        }
    }
    let png = png_codec::encode_rgba(width, height, &sheet)?;

    // manifest
    let nviews = m.views.count;
    let authored = if m.views.mirror { nviews / 2 + 1 } else { nviews };
    let views: Vec<ViewMeta> = (1..=nviews)
        .map(|k| {
            let derived = m.views.mirror && k > authored;
            ViewMeta {
                index: k,
                angle_deg: ((k - 1) as f64) * 360.0 / nviews as f64,
                mirrored: derived,
                mirror_of: if derived { Some(((nviews - (k - 1)) % nviews) + 1) } else { None },
            }
        })
        .collect();

    let mut frames = serde_json::Map::new();
    let mut anim_frames: Vec<Vec<serde_json::Map<String, serde_json::Value>>> = m
        .animations
        .iter()
        .map(|a| (0..a.frame_count).map(|_| serde_json::Map::new()).collect())
        .collect();
    for (i, fr) in m.frames.iter().enumerate() {
        let key = format!("{}/{}/v{}", slug(&m.animations[fr.anim].name), fr.frame, fr.view);
        let t = trims[i];
        let (px, py) = pos[i];
        // pivot: the feet point (bottom centre of the canvas) relative to the trimmed rect, normalised
        let feet_x = n as f64 / 2.0;
        let feet_y = n as f64;
        let pivot = Pivot { x: (feet_x - t.x as f64) / t.w as f64, y: (feet_y - t.y as f64) / t.h as f64 };
        frames.insert(
            key.clone(),
            serde_json::to_value(FrameMeta { rect: Rect { x: px, y: py, w: t.w, h: t.h }, source: t, pivot })?,
        );
        if let Some(af) = anim_frames.get_mut(fr.anim).and_then(|v| v.get_mut(fr.frame as usize)) {
            af.insert(fr.view.to_string(), serde_json::Value::String(key));
        }
    }
    let animations: Vec<serde_json::Value> = m
        .animations
        .iter()
        .enumerate()
        .map(|(ai, a)| {
            serde_json::json!({
                "name": a.name,
                "fps": a.fps,
                "loop": a.looping,
                "frames": anim_frames[ai].iter().enumerate().map(|(fi, views)| serde_json::json!({ "index": fi, "views": views })).collect::<Vec<_>>(),
            })
        })
        .collect();

    let manifest = serde_json::json!({
        "format": "threesprite-atlas",
        "version": 1,
        "sprite": m.sprite,
        "canvas": { "w": n, "h": n },
        "worldHeight": m.world_height,
        "image": format!("{}.png", m.sprite),
        "size": { "w": width, "h": height },
        "conventions": "angleDeg = camera bearing relative to the character's facing, anticlockwise seen from above; 0 = character faces the camera. pivot is the feet point (bottom centre of the canvas) relative to each trimmed rect, normalised to its size.",
        "views": { "count": nviews, "mirror": m.views.mirror, "list": views },
        "frames": frames,
        "animations": animations,
    });
    Ok((png, serde_json::to_string_pretty(&manifest)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_and_pow2() {
        let mut px = vec![0u8; 4 * 4 * 4];
        px[(1 * 4 + 2) * 4 + 3] = 255;
        px[(3 * 4 + 0) * 4 + 3] = 1;
        assert_eq!(opaque_bounds(&px, 4, 4), Some(Rect { x: 0, y: 1, w: 3, h: 3 }));
        assert_eq!(opaque_bounds(&vec![0u8; 16], 2, 2), None);
        assert_eq!(next_pow2(1), 1);
        assert_eq!(next_pow2(5), 8);
        assert_eq!(next_pow2(64), 64);
    }

    /// Builds a small sheet through the real exporter and checks the shape the
    /// runtime library parses. With `THREESPRITE_WRITE_FIXTURES=1` it also
    /// refreshes `runtime/test/fixtures/`, so that library tests against output
    /// this code actually produced rather than a hand-written copy of it.
    #[test]
    fn atlas_fixture_has_the_shape_the_runtime_parses() {
        let n: u32 = 16;
        let views = 4u32;
        let frame_count = 2u32;

        let mut refs = Vec::new();
        for f in 0..frame_count {
            for v in 1..=views {
                refs.push(serde_json::json!({ "anim": 0, "frame": f, "view": v }));
            }
        }
        let manifest: crate::bundle::Manifest = serde_json::from_value(serde_json::json!({
            "format": "atlas",
            "sink": { "kind": "dir", "path": "/tmp/threesprite-fixture" },
            "sprite": "HERO",
            "canvas": n,
            "views": { "count": views, "mirror": true },
            "worldHeight": 1.75,
            "animations": [{ "name": "walk", "fps": 10.0, "loop": true, "frameCount": frame_count }],
            "frames": refs,
            "options": { "atlasPow2": false }
        }))
        .expect("fixture manifest");

        // A different rectangle per frame so the trims and pivots all differ,
        // and one empty frame to cover the transparent path.
        let count = (frame_count * views) as usize;
        let mut buffers: Vec<Vec<u8>> = Vec::with_capacity(count);
        for i in 0..count {
            let mut px = vec![0u8; (n * n * 4) as usize];
            if i + 1 < count {
                let x0 = (i as u32) % 5;
                let y0 = 2 + (i as u32) % 3;
                let w = 4 + (i as u32) % 3;
                let h = 5 + (i as u32) % 4;
                for y in y0..(y0 + h).min(n) {
                    for x in x0..(x0 + w).min(n) {
                        let o = ((y * n + x) * 4) as usize;
                        px[o] = 200;
                        px[o + 1] = 40 + (i as u8) * 10;
                        px[o + 2] = 90;
                        px[o + 3] = 255;
                    }
                }
            }
            buffers.push(px);
        }
        let frames: Vec<&[u8]> = buffers.iter().map(|b| b.as_slice()).collect();
        let bundle = Bundle { manifest, frames };

        let mut warnings = Vec::new();
        let (png, json) = build(&bundle, &mut warnings).expect("atlas builds");
        assert_eq!(warnings.len(), 1, "the one empty frame is reported: {warnings:?}");

        let v: serde_json::Value = serde_json::from_str(&json).expect("manifest parses");
        assert_eq!(v["format"], "threesprite-atlas");
        assert_eq!(v["version"], 1);
        assert_eq!(v["image"], "HERO.png");
        assert_eq!(v["canvas"]["w"], n);
        assert_eq!(v["views"]["count"], views);

        // Every view is a real entry, mirrored ones included, so a renderer never flips.
        let list = v["views"]["list"].as_array().expect("view list");
        assert_eq!(list.len() as u32, views);
        assert_eq!(list[0]["angleDeg"], 0.0);
        assert_eq!(list[1]["angleDeg"], 90.0);
        assert_eq!(list[3]["mirrored"], true);
        assert_eq!(list[3]["mirrorOf"], 2);

        // Animation frames point at keys that exist in the frame table.
        let anim = &v["animations"][0];
        assert_eq!(anim["name"], "walk");
        assert_eq!(anim["fps"], 10.0);
        assert_eq!(anim["loop"], true);
        for f in 0..frame_count {
            for view in 1..=views {
                let key = anim["frames"][f as usize]["views"][view.to_string()]
                    .as_str()
                    .unwrap_or_else(|| panic!("frame {f} view {view} is listed"));
                assert_eq!(key, format!("walk/{f}/v{view}"));
                let meta = &v["frames"][key];
                assert!(meta["rect"]["w"].as_u64().unwrap() >= 1, "{key} has a rect");
                assert!(meta["source"]["w"].as_u64().unwrap() >= 1, "{key} has a source");
                assert!(meta["pivot"]["x"].is_number(), "{key} has a pivot");
            }
        }

        // The pivot is the feet point relative to the trimmed rect, which sits
        // below a frame trimmed above the bottom row.
        let first = &v["frames"]["walk/0/v1"];
        let src_y = first["source"]["y"].as_f64().unwrap();
        let src_h = first["source"]["h"].as_f64().unwrap();
        let pivot_y = first["pivot"]["y"].as_f64().unwrap();
        assert!((pivot_y - (n as f64 - src_y) / src_h).abs() < 1e-9, "pivot y follows the trim");
        assert!(pivot_y > 1.0, "feet fall below a frame that was trimmed short");

        if std::env::var("THREESPRITE_WRITE_FIXTURES").is_ok() {
            let dir = std::path::Path::new("../runtime/test/fixtures");
            std::fs::create_dir_all(dir).expect("fixture dir");
            std::fs::write(dir.join("sample-atlas.json"), &json).expect("write json");
            std::fs::write(dir.join("sample-atlas.png"), &png).expect("write png");
            println!("wrote fixtures to {}", dir.display());
        }
    }

    #[test]
    fn packing_never_overlaps_and_fits() {
        let sizes: Vec<(u32, u32)> = (0..40).map(|i| (3 + (i * 7) % 20, 2 + (i * 5) % 17)).collect();
        let (pos, w, h) = pack(&sizes, 1, true);
        assert!(h.is_power_of_two());
        for i in 0..sizes.len() {
            let (x, y) = pos[i];
            assert!(x + sizes[i].0 <= w && y + sizes[i].1 <= h, "item {i} out of bounds");
            for j in 0..i {
                let (xj, yj) = pos[j];
                let sep = x + sizes[i].0 <= xj || xj + sizes[j].0 <= x || y + sizes[i].1 <= yj || yj + sizes[j].1 <= y;
                assert!(sep, "items {i} and {j} overlap");
            }
        }
        let (p0, w0, h0) = pack(&[], 1, false);
        assert!(p0.is_empty() && w0 == 1 && h0 == 1);
    }
}

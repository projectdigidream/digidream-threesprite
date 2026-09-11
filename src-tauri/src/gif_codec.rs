//! Animated GIF from RGBA frames. Pixel art usually has ≤255 colours, so the
//! common path builds an exact global palette with index 0 transparent; more
//! colours fall back to per-frame quantisation (with a warning).
use std::borrow::Cow;
use std::collections::HashMap;

use gif::{DisposalMethod, Encoder, Frame, Repeat};

use crate::error::{Error, Result};

/// Alpha at or above this is opaque; below it the pixel is dropped (matches an alphaTest of 0.5).
const ALPHA_CUTOFF: u8 = 128;

pub struct GifOptions {
    /// Per-frame delay in centiseconds.
    pub delays_cs: Vec<u16>,
    pub repeat: bool,
}

pub fn encode(frames: &[&[u8]], w: u32, h: u32, opts: &GifOptions, warnings: &mut Vec<String>) -> Result<Vec<u8>> {
    if frames.is_empty() {
        return Err(Error::BadRequest("gif: no frames".into()));
    }
    if w > u16::MAX as u32 || h > u16::MAX as u32 {
        return Err(Error::BadRequest("gif: frame too large".into()));
    }
    let (w16, h16) = (w as u16, h as u16);

    // gather the colour set
    let mut colors: HashMap<[u8; 3], u8> = HashMap::new();
    let mut palette: Vec<u8> = vec![0, 0, 0]; // index 0 = transparent
    let mut exact = true;
    'outer: for f in frames {
        for px in f.chunks_exact(4) {
            if px[3] < ALPHA_CUTOFF {
                continue;
            }
            let rgb = [px[0], px[1], px[2]];
            if !colors.contains_key(&rgb) {
                if colors.len() >= 255 {
                    exact = false;
                    break 'outer;
                }
                colors.insert(rgb, (colors.len() + 1) as u8);
                palette.extend_from_slice(&rgb);
            }
        }
    }

    let mut out = Vec::new();
    {
        let mut enc = if exact {
            Encoder::new(&mut out, w16, h16, &palette)?
        } else {
            warnings.push("GIF has more than 255 colours; frames were quantised".into());
            Encoder::new(&mut out, w16, h16, &[])?
        };
        enc.set_repeat(if opts.repeat { Repeat::Infinite } else { Repeat::Finite(0) })?;
        for (i, f) in frames.iter().enumerate() {
            let delay = *opts.delays_cs.get(i).or(opts.delays_cs.last()).unwrap_or(&10);
            let mut frame = if exact {
                let mut idx = Vec::with_capacity((w * h) as usize);
                for px in f.chunks_exact(4) {
                    idx.push(if px[3] < ALPHA_CUTOFF { 0 } else { colors[&[px[0], px[1], px[2]]] });
                }
                Frame { width: w16, height: h16, buffer: Cow::Owned(idx), transparent: Some(0), ..Frame::default() }
            } else {
                let mut rgba = f.to_vec();
                for px in rgba.chunks_exact_mut(4) {
                    if px[3] < ALPHA_CUTOFF {
                        px[3] = 0;
                    } else {
                        px[3] = 255;
                    }
                }
                Frame::from_rgba_speed(w16, h16, &mut rgba, 10)
            };
            frame.delay = delay;
            frame.dispose = DisposalMethod::Background;
            enc.write_frame(&frame)?;
        }
    }
    Ok(out)
}

/// Centiseconds per frame for an fps; warns when the rate is not representable exactly.
pub fn delay_for_fps(fps: f64, warnings: &mut Vec<String>, label: &str) -> u16 {
    if !(fps > 0.0) {
        return 100;
    }
    let exact = 100.0 / fps;
    let d = exact.round().max(1.0);
    if (exact - d).abs() > 1e-6 {
        warnings.push(format!("{label}: GIF timing is in 1/100 s steps, so {fps} fps plays at {:.2} fps", 100.0 / d));
    }
    d as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_palette_round_trip() {
        let w = 2;
        let h = 2;
        let f0 = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255];
        let f1 = [0, 255, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0];
        let mut warnings = Vec::new();
        let gif = encode(&[&f0, &f1], w, h, &GifOptions { delays_cs: vec![12], repeat: true }, &mut warnings).unwrap();
        assert!(warnings.is_empty());
        let mut opts = gif::DecodeOptions::new();
        opts.set_color_output(gif::ColorOutput::RGBA);
        let mut d = opts.read_info(std::io::Cursor::new(gif)).unwrap();
        let a = d.read_next_frame().unwrap().unwrap().clone();
        assert_eq!(a.delay, 12);
        assert_eq!(&a.buffer[..4], &[255, 0, 0, 255]);
        assert_eq!(a.buffer[11], 0, "transparent pixel");
        let b = d.read_next_frame().unwrap().unwrap();
        assert_eq!(&b.buffer[..4], &[0, 255, 0, 255]);
    }

    #[test]
    fn quantises_when_over_255_colours() {
        let w = 32;
        let h = 16;
        let mut f = Vec::new();
        for i in 0..(w * h) {
            f.extend_from_slice(&[(i % 256) as u8, (i / 2 % 256) as u8, (i * 3 % 256) as u8, 255]);
        }
        let mut warnings = Vec::new();
        let gif = encode(&[&f], w, h, &GifOptions { delays_cs: vec![10], repeat: false }, &mut warnings).unwrap();
        assert!(!gif.is_empty());
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn delays() {
        let mut w = Vec::new();
        assert_eq!(delay_for_fps(8.0, &mut w, "x"), 13); // 12.5 rounds half away from zero
        assert_eq!(w.len(), 1);
        assert_eq!(delay_for_fps(10.0, &mut w, "x"), 10);
        assert_eq!(delay_for_fps(0.0, &mut w, "x"), 100);
        assert_eq!(w.len(), 1);
    }
}

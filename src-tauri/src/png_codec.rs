use std::io::Cursor;

use crate::error::{Error, Result};

/// Encode straight-alpha RGBA8 as PNG.
pub fn encode_rgba(w: u32, h: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    if rgba.len() != (w * h * 4) as usize {
        return Err(Error::BadRequest(format!("png encode: expected {} bytes, got {}", w * h * 4, rgba.len())));
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header()?;
        writer.write_image_data(rgba)?;
    }
    Ok(out)
}

/// Decode any 8-bit-capable PNG to straight RGBA8 (used by the tests; kept for PNG import through Rust later).
#[cfg_attr(not(test), allow(dead_code))]
pub fn decode_rgba(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info()?;
    let size = reader.output_buffer_size().ok_or_else(|| Error::Other("png decode: image too large".into()))?;
    let mut buf = vec![0u8; size];
    let info = reader.next_frame(&mut buf)?;
    let data = &buf[..info.buffer_size()];
    let (w, h) = (info.width, info.height);
    let n = (w * h) as usize;
    let mut out = Vec::with_capacity(n * 4);
    match info.color_type {
        png::ColorType::Rgba => out.extend_from_slice(data),
        png::ColorType::Rgb => {
            for px in data.chunks_exact(3) {
                out.extend_from_slice(&[px[0], px[1], px[2], 255]);
            }
        }
        png::ColorType::Grayscale => {
            for &g in data {
                out.extend_from_slice(&[g, g, g, 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for px in data.chunks_exact(2) {
                out.extend_from_slice(&[px[0], px[0], px[0], px[1]]);
            }
        }
        other => return Err(Error::Other(format!("png decode: unsupported colour type {other:?}"))),
    }
    Ok((w, h, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let w = 3;
        let h = 2;
        let mut px = Vec::new();
        for i in 0..(w * h) {
            px.extend_from_slice(&[i as u8 * 40, 255 - i as u8 * 40, 7, if i % 2 == 0 { 255 } else { 128 }]);
        }
        let png = encode_rgba(w, h, &px).unwrap();
        let (w2, h2, back) = decode_rgba(&png).unwrap();
        assert_eq!((w2, h2), (w, h));
        assert_eq!(back, px);
    }
}

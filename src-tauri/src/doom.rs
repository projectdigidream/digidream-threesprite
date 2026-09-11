//! Classic Doom-style sprite lump naming: `NNNNFR` — a 4-character sprite
//! name, a frame letter A–Z, and a rotation character: `0` for a single
//! view, `1`–`8` for eight views, and `1`–`9`,`A`–`G` for the sixteen-view
//! extension used by modern source ports. Rotation 1 faces the viewer and
//! rotations go anticlockwise seen from above, which is also this app's view
//! convention, so view k maps straight to rotation k.
use crate::error::{Error, Result};

pub fn validate_sprite_name(s: &str) -> Result<()> {
    if s.len() == 4 && s.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(Error::BadRequest(format!("sprite name \"{s}\" must be 4 characters, A–Z or 0–9")))
    }
}

pub fn frame_letter(index: u32) -> Result<char> {
    if index < 26 {
        Ok((b'A' + index as u8) as char)
    } else {
        Err(Error::BadRequest(format!(
            "Doom-style naming supports at most 26 frames per sprite (frame letters A–Z); frame {} would need a 27th letter",
            index + 1
        )))
    }
}

/// Whether a view count can be expressed in Doom-style names without dropping views.
pub fn supports_view_count(n: u32) -> bool {
    matches!(n, 1 | 8 | 16)
}

pub fn rotation_char(view_count: u32, view: u32) -> Result<char> {
    match view_count {
        1 => Ok('0'),
        8 if (1..=8).contains(&view) => Ok((b'0' + view as u8) as char),
        16 if (1..=9).contains(&view) => Ok((b'0' + view as u8) as char),
        16 if (10..=16).contains(&view) => Ok((b'A' + (view - 10) as u8) as char),
        _ => Err(Error::BadRequest(format!(
            "Doom-style naming supports 1, 8 or 16 views, not {view_count} (or export view 1 only as rotation 0)"
        ))),
    }
}

pub fn lump_name(sprite: &str, letter: char, rotation: char) -> String {
    format!("{sprite}{letter}{rotation}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(validate_sprite_name("TROO").is_ok());
        assert!(validate_sprite_name("tro0").is_err());
        assert!(validate_sprite_name("TROOP").is_err());
        assert_eq!(frame_letter(0).unwrap(), 'A');
        assert_eq!(frame_letter(25).unwrap(), 'Z');
        assert!(frame_letter(26).is_err());
        assert_eq!(rotation_char(1, 1).unwrap(), '0');
        assert_eq!(rotation_char(8, 1).unwrap(), '1');
        assert_eq!(rotation_char(8, 8).unwrap(), '8');
        assert_eq!(rotation_char(16, 9).unwrap(), '9');
        assert_eq!(rotation_char(16, 10).unwrap(), 'A');
        assert_eq!(rotation_char(16, 16).unwrap(), 'G');
        assert!(rotation_char(6, 1).is_err());
        assert!(rotation_char(8, 9).is_err());
        assert_eq!(lump_name("TROO", 'A', '3'), "TROOA3");
        assert!(supports_view_count(16));
        assert!(!supports_view_count(4));
    }
}

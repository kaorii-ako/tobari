use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::io::{Read, Write};

pub const MAX_INBOUND_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_OUTBOUND_BYTES: usize = 64 * 1024 * 1024;

pub fn read_message(reader: &mut impl Read) -> Result<Option<Value>> {
    let mut length_bytes = [0u8; 4];
    match reader.read_exact(&mut length_bytes) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let length = u32::from_le_bytes(length_bytes) as usize;
    if length > MAX_INBOUND_BYTES {
        bail!("native message too large ({length}), dropping");
    }
    let mut buffer = vec![0u8; length];
    reader.read_exact(&mut buffer)?;
    serde_json::from_slice(&buffer)
        .map(Some)
        .context("malformed JSON from extension")
}

pub fn write_message(writer: &mut impl Write, value: &Value) -> Result<()> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() > MAX_OUTBOUND_BYTES {
        bail!(
            "native message too large ({}), refusing to write",
            bytes.len()
        );
    }
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()?;
    Ok(())
}

pub const EXPECTED_ORIGIN: &str = "chrome-extension://icoelnobjkgnmgemdeljcnkemjmhomcb/";

pub fn validate_origin(origin: &str) -> Result<()> {
    if origin != EXPECTED_ORIGIN {
        bail!("unexpected origin {origin:?} — refusing to serve");
    }
    Ok(())
}


#[cfg(test)]
mod origin_tests {
    use super::{validate_origin, EXPECTED_ORIGIN};
    use base64::Engine;
    use sha2::{Digest, Sha256};

    const EXTENSION_MANIFEST: &str = include_str!("../../../../extension/manifest.json");

    fn id_from_packed_key(key_b64: &str) -> String {
        let der = base64::engine::general_purpose::STANDARD
            .decode(key_b64.trim())
            .expect("manifest key is not valid base64");
        let digest = Sha256::digest(&der);
        digest
            .iter()
            .take(16)
            .flat_map(|byte| [byte >> 4, byte & 0x0f])
            .map(|nibble| (b'a' + nibble) as char)
            .collect()
    }

    #[test]
    fn pinned_origin_matches_the_extension_key() {
        let manifest: serde_json::Value =
            serde_json::from_str(EXTENSION_MANIFEST).expect("extension manifest is not valid JSON");
        let key = manifest["key"]
            .as_str()
            .expect("extension manifest has no packed key");
        let expected = format!("chrome-extension://{}/", id_from_packed_key(key));
        assert_eq!(
            EXPECTED_ORIGIN, expected,
            "EXPECTED_ORIGIN has drifted from the packed key in extension/manifest.json"
        );
    }

    #[test]
    fn pinned_origin_is_a_syntactically_valid_extension_id() {
        let id = EXPECTED_ORIGIN
            .trim_start_matches("chrome-extension://")
            .trim_end_matches('/');
        assert_eq!(id.len(), 32, "extension ids are 32 characters");
        assert!(
            id.bytes().all(|b| (b'a'..=b'p').contains(&b)),
            "extension ids use only a-p; {id} is not a reachable origin"
        );
    }

    #[test]
    fn foreign_origins_are_refused() {
        assert!(validate_origin(EXPECTED_ORIGIN).is_ok());
        assert!(validate_origin("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/").is_err());
        assert!(validate_origin("https://example.com").is_err());
        assert!(validate_origin("").is_err());
    }
}

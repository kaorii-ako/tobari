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

pub const EXPECTED_ORIGIN: &str = "chrome-extension://82e4bde19a6dc64c34b92da4c9c7ec21/";

pub fn validate_origin(origin: &str) -> Result<()> {
    if origin != EXPECTED_ORIGIN {
        bail!("unexpected origin {origin:?} — refusing to serve");
    }
    Ok(())
}


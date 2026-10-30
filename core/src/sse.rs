#[derive(Default)]
pub struct SseBuffer {
    buf: String,
}

impl SseBuffer {
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.push_str(&String::from_utf8_lossy(bytes));
        let mut out = Vec::new();
        while let Some(pos) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=pos).collect();
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(rest) = line.strip_prefix("data:") {
                let payload = rest.trim_start();
                if !payload.is_empty() && payload != "[DONE]" {
                    out.push(payload.to_owned());
                }
            } else if line.starts_with('{') {
                out.push(line.to_owned());
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn splits_across_chunks() {
        let mut b = super::SseBuffer::default();
        assert!(b.feed(b"data: {\"a\":").is_empty());
        let got = b.feed(b"1}\n\ndata: [DONE]\n");
        assert_eq!(got, vec!["{\"a\":1}".to_owned()]);
    }

    #[test]
    fn accepts_ndjson() {
        let mut b = super::SseBuffer::default();
        assert_eq!(b.feed(b"{\"x\":2}\n"), vec!["{\"x\":2}".to_owned()]);
    }
}

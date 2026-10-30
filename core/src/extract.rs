pub fn html_to_text(html: &str) -> (String, String) {
    let lower = html.to_lowercase();
    let title = lower
        .find("<title")
        .and_then(|s| lower[s..].find('>').map(|e| s + e + 1))
        .and_then(|s| {
            lower[s..]
                .find("</title>")
                .map(|e| html[s..s + e].trim().to_owned())
        })
        .map(|t| decode(&t))
        .unwrap_or_default();
    let mut out = String::new();
    let mut i = 0;
    let bytes = html.as_bytes();
    let skip = [
        "script", "style", "noscript", "svg", "nav", "footer", "template",
    ];
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let rest = &lower[i + 1..];
            if let Some(tag) = skip.iter().find(|t| rest.starts_with(*t)) {
                let close = format!("</{tag}");
                match lower[i..].find(&close) {
                    Some(e) => {
                        i += e;
                        i += lower[i..]
                            .find('>')
                            .map(|x| x + 1)
                            .unwrap_or(lower.len() - i);
                    }
                    None => break,
                }
                continue;
            }
            let block = [
                "p", "div", "br", "li", "h1", "h2", "h3", "h4", "tr", "section", "article", "/p",
                "/div", "/li", "/h",
            ]
            .iter()
            .any(|t| rest.starts_with(t));
            match lower[i..].find('>') {
                Some(e) => i += e + 1,
                None => break,
            }
            if block {
                out.push('\n');
            } else {
                out.push(' ');
            }
            continue;
        }
        let next = html[i..].find('<').map(|n| i + n).unwrap_or(html.len());
        out.push_str(&html[i..next]);
        i = next;
    }
    let text = decode(&out)
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    (title, text)
}

fn decode(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    #[test]
    fn strips_scripts_and_keeps_text() {
        let (t, x) = super::html_to_text(
            "<html><head><title>帳 &amp; test</title><style>p{}</style></head><body><nav>menu</nav><p>Hello <b>world</b></p><script>evil()</script><p>ภาษาไทย</p></body></html>",
        );
        assert_eq!(t, "帳 & test");
        assert!(x.contains("Hello world"));
        assert!(x.contains("ภาษาไทย"));
        assert!(!x.contains("evil") && !x.contains("menu"));
    }
}

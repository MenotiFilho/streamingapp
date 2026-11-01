//! The bytes the built Remote names but does not carry, and the one refusal.
//!
//! The page itself travels as the embedded directory [`crate::remote_page`]
//! compiles in (ADR-0035 §3). What stays here is the Host's own route: the
//! repertory token sheet's `@font-face` rules name four faces by absolute
//! `/fonts/<name>` path, so the window and the phone read one set of bytes from
//! one route (#153). The bytes are already in `public/fonts`, beside the sheet
//! the window imports; this module answers them.
//!
//! The 404 lives here too. Every path the page server refuses is refused the
//! same way: an empty body, which is what a browser asking for a favicon, the
//! build's metadata or a name the artifact does not hold is owed.

use std::io;
use std::net::TcpStream;

use crate::http;

/// The faces the repertory token sheet names (#153). The window loads them from
/// its own origin; the served page receives the same bytes at `/fonts/<name>`,
/// so a phone without the faces is a fallback, not a different design.
const FONT_BODONI_MODA: &[u8] =
    include_bytes!("../../../public/fonts/bodoni-moda-latin-wght-normal.woff2");
const FONT_INTER: &[u8] = include_bytes!("../../../public/fonts/inter-latin-wght-normal.woff2");
const FONT_PLEX_400: &[u8] =
    include_bytes!("../../../public/fonts/ibm-plex-mono-latin-400-normal.woff2");
const FONT_PLEX_500: &[u8] =
    include_bytes!("../../../public/fonts/ibm-plex-mono-latin-500-normal.woff2");

/// The bytes of one requested face, by the name in its `/fonts/` URL.
pub(crate) fn font(path: &str) -> Option<&'static [u8]> {
    match path.strip_prefix("/fonts/")? {
        "bodoni-moda-latin-wght-normal.woff2" => Some(FONT_BODONI_MODA),
        "inter-latin-wght-normal.woff2" => Some(FONT_INTER),
        "ibm-plex-mono-latin-400-normal.woff2" => Some(FONT_PLEX_400),
        "ibm-plex-mono-latin-500-normal.woff2" => Some(FONT_PLEX_500),
        _ => None,
    }
}

/// The one answer for a path this Host does not serve.
pub(crate) fn not_found(stream: &mut TcpStream) -> io::Result<()> {
    http::write_document(stream, "404 Not Found", "text/plain; charset=utf-8", b"")
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::font;

    /// The sheet the window imports and the served page is built from.
    const TOKENS: &str = include_str!("../../../src/kit/tokens.css");

    /// Every face the token sheet's `@font-face` rules name, by file name.
    ///
    /// The rules write an absolute `url("/fonts/<name>")`, which is the path
    /// this module answers.
    fn referenced_fonts(css: &str) -> BTreeSet<String> {
        const MARKER: &str = "url(\"/fonts/";
        let mut names = BTreeSet::new();
        let mut rest = css;
        while let Some(start) = rest.find(MARKER) {
            let after = &rest[start + MARKER.len()..];
            let end = after.find('"').expect("the font URL is quoted");
            names.insert(after[..end].to_owned());
            rest = &after[end..];
        }
        names
    }

    #[test]
    fn the_face_table_is_exactly_the_faces_the_token_sheet_names() {
        // The sheet and the Host cannot drift: every absolute `/fonts/` URL the
        // sheet names is a face this module carries, and nothing else is.
        let named = referenced_fonts(TOKENS);
        assert_eq!(named.len(), 4, "the sheet names its four faces: {named:?}");

        for name in &named {
            let bytes = font(&format!("/fonts/{name}"))
                .unwrap_or_else(|| panic!("the Host carries /fonts/{name}"));
            assert!(bytes.starts_with(b"wOF2"), "/fonts/{name} is a woff2 face");
        }

        assert_eq!(
            font("/fonts/not-a-face.woff2"),
            None,
            "a name the sheet does not carry is not a face"
        );
    }
}

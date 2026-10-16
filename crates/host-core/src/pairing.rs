//! The pairing code: the short thing the Host shows, and a client redeems once.
//!
//! A code is six characters from an alphabet with the look-alikes taken out, so
//! it survives being read off one screen and typed into another. It is not a
//! password and not stored: the Host holds the one it is showing, redeeming it
//! mints a [`crate::Device`] and rotates the code, and a code that has been
//! redeemed is not a code any more (#31).

use serde::{Deserialize, Serialize};

use crate::random;

/// The characters a code is spelled in: the digits and capitals that are hard
/// to mistake for one another when read off a screen. `I`, `O`, `0` and `1` are
/// deliberately absent, so nothing has to decide which of two glyphs was typed.
const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// How many characters a code is. Six characters of this alphabet is thirty
/// bits: a handful of attempts cannot find one, and a person can read it out.
pub const PAIRING_CODE_LEN: usize = 6;

/// The code the Host is showing.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PairingCode(String);

impl PairingCode {
    /// A fresh code, from the operating system's randomness.
    pub(crate) fn generate() -> Self {
        Self::from_bytes(&random::bytes::<PAIRING_CODE_LEN>())
    }

    /// The code those bytes spell. Five bits of each byte name one character, so
    /// every combination of bytes is a code and every code is equally likely.
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let code: String = bytes
            .iter()
            .take(PAIRING_CODE_LEN)
            .map(|byte| ALPHABET[usize::from(byte & 0x1f)] as char)
            .collect();
        Self(code)
    }

    /// Parse what a person typed: the case and the grouping they may have added
    /// are theirs, not the code's.
    ///
    /// A code written `abcd-ef`, `ABCD EF` or `abcdef` is the same code; one with
    /// a character the alphabet does not carry — an `O` for a `0`, an `l` for a
    /// `1` — is not a code at all and is refused rather than coerced.
    pub fn parse(raw: &str) -> Result<Self, InvalidPairingCode> {
        let code: String = raw
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .map(|c| c.to_ascii_uppercase())
            .collect();

        let invalid = || InvalidPairingCode {
            code: raw.to_owned(),
        };

        if code.chars().count() != PAIRING_CODE_LEN
            || !code.bytes().all(|byte| ALPHABET.contains(&byte))
        {
            return Err(invalid());
        }

        Ok(Self(code))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for PairingCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A string that is not a pairing code, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{code:?} is not a pairing code")]
pub struct InvalidPairingCode {
    pub code: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_is_the_length_and_alphabet_it_claims_to_be() {
        for byte in 0..=u8::MAX {
            let code = PairingCode::from_bytes(&[byte; PAIRING_CODE_LEN]);
            assert_eq!(code.as_str().chars().count(), PAIRING_CODE_LEN);
            assert!(
                code.as_str().bytes().all(|b| ALPHABET.contains(&b)),
                "{code} is spelled in the alphabet a person can read"
            );
        }
    }

    #[test]
    fn a_code_a_person_typed_is_read_regardless_of_case_and_grouping() {
        let code = PairingCode::from_bytes(&[0x5f, 0x00, 0x1f, 0x0b, 0x02, 0x1d]);
        let lower = code.as_str().to_lowercase();

        assert_eq!(
            PairingCode::parse(&lower).expect("the same code in lower case"),
            code
        );
        assert_eq!(
            PairingCode::parse(&format!("{} {}", &code.as_str()[..3], &code.as_str()[3..]))
                .expect("the same code read off a screen"),
            code
        );
    }

    #[test]
    fn a_code_with_a_letter_the_alphabet_leaves_out_is_refused_rather_than_coerced() {
        // `O` and `I` are not in the alphabet precisely because they read as `0`
        // and `1`; guessing which was meant is exactly what the design avoids.
        for raw in ["OOOOOO", "IIIIII", "ABCDE", "ABCDEFG", "AB1DEF", ""] {
            assert!(
                PairingCode::parse(raw).is_err(),
                "{raw:?} is not a pairing code"
            );
        }
    }

    #[test]
    fn two_generated_codes_are_not_the_same() {
        // Not a proof of randomness, a canary for a code that stopped being drawn
        // from randomness at all.
        let codes: std::collections::HashSet<_> = (0..16)
            .map(|_| PairingCode::generate().as_str().to_owned())
            .collect();
        assert!(codes.len() > 1, "a code is drawn, not remembered");
    }
}

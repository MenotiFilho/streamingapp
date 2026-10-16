//! Devices: a client that paired, and the token that client holds.
//!
//! Pairing is the Host letting one device in on its own: the owner reads a short
//! code off the Host's window, a client on another machine redeems it once, and
//! what it gets back is a token of its own. The token is what every later frame
//! from that device is judged by, and it is revocable on its own without
//! disturbing the others (#31).
//!
//! What the Host *keeps* of a token is not the token: a [`Device`] holds a
//! [`TokenDigest`], so a copy of the database is a list of what paired rather
//! than a list of live keys. The token itself is handed to the device once, in
//! the answer to the pairing, and read from the store only to be compared.

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::random;

/// The longest name a device may be paired under.
const MAX_NAME_LEN: usize = 64;

/// The longest id a Device may carry, and the alphabet it is spelled in.
const MAX_ID_LEN: usize = 64;

/// The bytes behind a device token: 256 bits, which is what makes it worth
/// storing only a digest of.
const TOKEN_BYTES: usize = 32;

/// The length of a token's base64url spelling, unpadded.
const TOKEN_LEN: usize = 43;

/// A device the Host has paired: the id it is revoked by, the name it was paired
/// under, the digest of its token, and when it paired.
///
/// The token itself is deliberately not here — [`Device::matches`] is the only
/// thing that needs it, and it asks a digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Device {
    id: DeviceId,
    name: DeviceName,
    digest: TokenDigest,
    paired_at: i64,
}

impl Device {
    /// Pair `name` under a fresh token, at `paired_at`: the Host's own act, once
    /// a code has been redeemed. The token is returned beside the device, because
    /// it is the device that gets to keep it, not the Host.
    pub(crate) fn paired(name: DeviceName, paired_at: i64) -> (Self, DeviceToken) {
        let token = DeviceToken::generate();
        let device = Self {
            id: DeviceId::generate(),
            name,
            digest: token.digest(),
            paired_at,
        };
        (device, token)
    }

    /// The same device, as a store that read it back holds it — judged exactly as
    /// pairing judged it, so nothing a store hands back can be a device the Host
    /// would not have made.
    pub fn read(id: DeviceId, name: DeviceName, digest: TokenDigest, paired_at: i64) -> Self {
        Self {
            id,
            name,
            digest,
            paired_at,
        }
    }

    pub fn id(&self) -> &DeviceId {
        &self.id
    }

    pub fn name(&self) -> &DeviceName {
        &self.name
    }

    pub fn digest(&self) -> &TokenDigest {
        &self.digest
    }

    pub fn paired_at(&self) -> i64 {
        self.paired_at
    }

    /// Whether this device is the one `token` was issued to. The comparison is
    /// over digests, so a token that was never issued matches nothing.
    pub fn matches(&self, token: &DeviceToken) -> bool {
        self.digest == token.digest()
    }

    /// The device as every client is told of it — the name and the when, never
    /// the digest of what it holds.
    pub fn summary(&self) -> DeviceSummary {
        DeviceSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            paired_at: self.paired_at,
        }
    }
}

/// A device as a Snapshot carries it: enough for the window to list it and to
/// name it when revoking, and no part of what it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceSummary {
    pub id: DeviceId,
    pub name: DeviceName,
    /// Milliseconds since the epoch, so a client can say how long ago.
    pub paired_at: i64,
}

/// A device's own id, which is what revokes it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceId(String);

impl DeviceId {
    /// A fresh id: 64 bits, spelled in hex. An id is not a secret — it is what a
    /// revoke names and what a Snapshot carries — so it needs to be unique
    /// rather than unguessable.
    pub(crate) fn generate() -> Self {
        Self(hex(&random::bytes::<8>()))
    }

    /// Parse an id, or say why this string is not one.
    pub fn parse(raw: &str) -> Result<Self, InvalidDeviceId> {
        let invalid = || InvalidDeviceId { id: raw.to_owned() };

        if raw.is_empty() || raw.len() > MAX_ID_LEN {
            return Err(invalid());
        }
        if raw
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        {
            return Err(invalid());
        }

        Ok(Self(raw.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for DeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A string that is not a device id, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{id:?} is not a device id")]
pub struct InvalidDeviceId {
    pub id: String,
}

/// The name a device was paired under: what the owner typed on the phone, and
/// what the window lists it by.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceName(String);

impl DeviceName {
    /// Parse a name, trimmed of the space a person leaves around it.
    pub fn parse(raw: &str) -> Result<Self, InvalidDeviceName> {
        let name = raw.trim();
        let invalid = || InvalidDeviceName {
            name: raw.to_owned(),
        };

        if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
            return Err(invalid());
        }
        if name.chars().any(char::is_control) {
            return Err(invalid());
        }

        Ok(Self(name.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for DeviceName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A string that is not a device name, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{name:?} is not a name this Host will pair a device under")]
pub struct InvalidDeviceName {
    pub name: String,
}

/// A device's token: the long-lived secret a paired client presents on every
/// frame, spelled in base64url so it survives a URL, a header and a JSON string
/// unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceToken(String);

impl DeviceToken {
    /// A fresh token: 256 bits from the operating system.
    pub(crate) fn generate() -> Self {
        let bytes = random::bytes::<TOKEN_BYTES>();
        Self(base64url(&bytes))
    }

    /// Parse a token, or say why this string is not one. A token the Host never
    /// issued is still a *parsed* token: whether it matches a device is a
    /// question for [`Device::matches`], and the answer is no.
    pub fn parse(raw: &str) -> Result<Self, InvalidDeviceToken> {
        let invalid = || InvalidDeviceToken;

        if raw.len() != TOKEN_LEN
            || !raw
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(invalid());
        }

        Ok(Self(raw.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// What the Host keeps of it: the digest, never the token.
    pub fn digest(&self) -> TokenDigest {
        let mut hasher = Sha256::new();
        hasher.update(self.0.as_bytes());
        TokenDigest(hex(&hasher.finalize()))
    }
}

/// A string that is not a device token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("that is not a device token")]
pub struct InvalidDeviceToken;

/// What the Host keeps of a device's token: a SHA-256 digest, hex-spelled. Not
/// reversible into the token, and not usable as one.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TokenDigest(String);

impl TokenDigest {
    /// Parse a digest, or say why this string is not one. A digest of the wrong
    /// shape is not a digest this Host wrote, so a row carrying one is unreadable
    /// rather than a device that cannot be matched.
    pub fn parse(raw: &str) -> Result<Self, InvalidTokenDigest> {
        if raw.len() != 64 || !raw.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(InvalidTokenDigest {
                digest: raw.to_owned(),
            });
        }
        Ok(Self(raw.to_ascii_lowercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A string that is not a token digest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("that is not a token digest")]
pub struct InvalidTokenDigest {
    pub digest: String,
}

/// Bytes as lowercase hex. The spelling is the Host's own — nothing parses it
/// back into bytes — so it only has to be stable and readable in a database.
fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    out
}

/// Bytes as unpadded base64url, the alphabet a token is spelled in.
fn base64url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_devices_token_matches_it_and_no_other() {
        let (device, token) = Device::paired(
            DeviceName::parse("Phone").expect("a name"),
            1_700_000_000_000,
        );

        assert!(device.matches(&token));
        assert!(!device.matches(&DeviceToken::generate()));
    }

    #[test]
    fn what_the_host_keeps_is_not_the_token() {
        let (device, token) = Device::paired(
            DeviceName::parse("Phone").expect("a name"),
            1_700_000_000_000,
        );

        assert_ne!(device.digest().as_str(), token.as_str());
        assert_eq!(device.digest().as_str().len(), 64);
    }

    #[test]
    fn a_token_the_host_never_issued_parses_and_is_not_a_digest_of_anything() {
        let forged = DeviceToken::parse(&"a".repeat(TOKEN_LEN)).expect("43 base64url characters");
        let (device, _) = Device::paired(
            DeviceName::parse("Phone").expect("a name"),
            1_700_000_000_000,
        );

        assert!(!device.matches(&forged));
    }

    #[test]
    fn a_token_that_is_not_one_is_refused() {
        for raw in [
            "",
            "short",
            &"a".repeat(TOKEN_LEN + 1),
            &"!".repeat(TOKEN_LEN),
        ] {
            assert!(
                DeviceToken::parse(raw).is_err(),
                "{raw:?} is not a device token"
            );
        }
    }

    #[test]
    fn a_name_is_trimmed_and_an_empty_one_is_refused() {
        assert_eq!(
            DeviceName::parse("  Kitchen TV  ")
                .expect("a name")
                .as_str(),
            "Kitchen TV"
        );
        assert!(DeviceName::parse("   ").is_err());
        assert!(DeviceName::parse(&"n".repeat(MAX_NAME_LEN + 1)).is_err());
    }

    #[test]
    fn a_summary_carries_the_name_and_the_when_but_never_the_digest() {
        let (device, _) = Device::paired(
            DeviceName::parse("Phone").expect("a name"),
            1_700_000_000_000,
        );

        let wire = serde_json::to_value(device.summary()).expect("a summary serializes");
        assert_eq!(
            wire,
            serde_json::json!({
                "id": device.id().as_str(),
                "name": "Phone",
                "pairedAt": 1_700_000_000_000_i64,
            }),
        );
    }
}

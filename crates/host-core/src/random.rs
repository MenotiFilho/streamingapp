//! Bytes the operating system says are random.
//!
//! The Host makes two of them: a pairing code and a device token. Both are
//! secrets — one is redeemed for the other — so neither is spelled out of a
//! clock or a counter, and the one call that fetches them is here rather than
//! scattered through the callers. A machine whose operating system will not
//! produce randomness cannot pair a device safely, and this is where that is
//! said once rather than guessed at twice.

/// Fill a buffer with random bytes.
///
/// Panics where the operating system refuses: there is no safe fallback to a
/// clock, and a Host that cannot pair must not pretend it did.
pub(crate) fn bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).expect("the operating system provides randomness");
    out
}

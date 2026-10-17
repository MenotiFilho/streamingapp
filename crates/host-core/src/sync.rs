//! The merge between the Host's Watch progress and a Stremio account's library
//! (#30): a pure decision surface, with no I/O in it.
//!
//! The two sides keep the same fact in different shapes, and a merge that treats
//! them alike loses data:
//!
//! - **A position** is one per *Title* on Stremio's side — the library item
//!   carries the Video last played, how far in, and when — and one per *Video* on
//!   the Host's. Two writes to it disagree by *time*, so the newest wins.
//! - **The watched bitfield** is Stremio's record of *which episodes of a series
//!   are watched*: `{anchor video}:{anchor length}:{base64 of zlib of bits}`, the
//!   bit at an episode's place in the Title's own list of Videos. It disagrees by
//!   *union*: watching episode 5 here and episode 6 there is both watched, and a
//!   position written after must not erase either. Taking the newer of two
//!   bitfields whole would lose whichever side was older.
//!
//! [`merge`] decides one Title at a time and says what to change on each side;
//! the Host does the reading and writing around it.

use std::io::{Read, Write};

use base64::Engine as _;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use serde_json::{json, Map, Value};

use crate::progress::{finished, WatchProgress};
use crate::request::VideoRef;
use crate::stremio::SyncError;

/// The most of a decompressed bitfield the Host will read: thirty-two thousand
/// episodes, which is no series.
const MAX_BITS_BYTES: u64 = 4096;

/// A position this close to another is the same position: Stremio keeps
/// milliseconds and the Host seconds, and neither is the unit a resume is
/// placed to.
const SAME_POSITION: f64 = 1.0;

/// A run of bits, least significant bit first within each byte — Stremio's
/// `BitField8`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BitField {
    bytes: Vec<u8>,
}

impl BitField {
    /// Read the `base64(zlib(bytes))` form.
    pub fn decode(encoded: &str) -> Result<Self, SyncError> {
        let malformed = |detail: &str| SyncError::Malformed {
            detail: format!("a watched bitfield {detail}"),
        };
        let compressed = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| malformed("is not base64"))?;
        let mut bytes = Vec::new();
        ZlibDecoder::new(compressed.as_slice())
            .take(MAX_BITS_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| malformed("is not zlib"))?;
        if bytes.len() as u64 > MAX_BITS_BYTES {
            return Err(malformed("is larger than the Host will read"));
        }
        Ok(Self { bytes })
    }

    /// The `base64(zlib(bytes))` form.
    pub fn encode(&self) -> String {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        // Writing into a Vec cannot fail.
        let _ = encoder.write_all(&self.bytes);
        let compressed = encoder.finish().unwrap_or_default();
        base64::engine::general_purpose::STANDARD.encode(compressed)
    }

    /// Whether bit `index` is set. A bit past the end is unset.
    pub fn get(&self, index: usize) -> bool {
        self.bytes
            .get(index / 8)
            .is_some_and(|byte| (byte >> (index % 8)) & 1 == 1)
    }

    /// Set or clear bit `index`, growing the run to hold it.
    pub fn set(&mut self, index: usize, value: bool) {
        let byte = index / 8;
        if byte >= self.bytes.len() {
            self.bytes.resize(byte + 1, 0);
        }
        if value {
            self.bytes[byte] |= 1 << (index % 8);
        } else {
            self.bytes[byte] &= !(1 << (index % 8));
        }
    }
}

/// Stremio's record of which episodes of a Title are watched, with the anchor it
/// is aligned by.
///
/// The bit at index *i* is the *i*th Video of the Title — in the order the Addon
/// lists them *when this was written*. The Addon's list changes (an episode is
/// added in the middle), and the anchor is how a reader realigns: the last
/// watched Video, and how far into the list it was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchedField {
    anchor_video: String,
    anchor_length: usize,
    bits: BitField,
}

impl WatchedField {
    /// Read `{anchor video}:{anchor length}:{bitfield}`. The anchor's id carries
    /// colons of its own, so the two fields on the right are taken first.
    pub fn parse(text: &str) -> Result<Self, SyncError> {
        let mut parts: Vec<&str> = text.split(':').collect();
        if parts.len() < 3 {
            return Err(SyncError::Malformed {
                detail: "a watched field has too few parts".to_owned(),
            });
        }
        let bits = BitField::decode(parts.pop().unwrap_or_default())?;
        let anchor_length = parts
            .pop()
            .and_then(|length| length.parse::<usize>().ok())
            .ok_or_else(|| SyncError::Malformed {
                detail: "a watched field's anchor length is not a number".to_owned(),
            })?;

        Ok(Self {
            anchor_video: parts.join(":"),
            anchor_length,
            bits,
        })
    }

    /// The field that says exactly these Videos, in this order, are watched.
    pub fn from_flags(flags: &[bool], order: &[String]) -> Self {
        let last = flags.iter().rposition(|flag| *flag).unwrap_or(0);
        let mut bits = BitField::default();
        for (index, flag) in flags.iter().enumerate() {
            if *flag {
                bits.set(index, true);
            }
        }
        Self {
            anchor_video: order
                .get(last)
                .cloned()
                .unwrap_or_else(|| "undefined".to_owned()),
            anchor_length: last + 1,
            bits,
        }
    }

    /// Which of `order` this says are watched, realigned by the anchor.
    ///
    /// Where the anchor is at the place it was written, nothing moves; where the
    /// Addon's list has grown or shrunk before it, the whole run shifts with it;
    /// and an anchor that is gone from the list is read as written, because that
    /// is the better guess than reading nothing.
    pub fn resolve(&self, order: &[String]) -> Vec<bool> {
        let shift = match order.get(self.anchor_length.wrapping_sub(1)) {
            Some(video) if *video == self.anchor_video => 0,
            _ => order
                .iter()
                .position(|video| *video == self.anchor_video)
                .map_or(0, |at| at as isize + 1 - self.anchor_length as isize),
        };

        (0..order.len())
            .map(|index| {
                usize::try_from(index as isize - shift).is_ok_and(|from| self.bits.get(from))
            })
            .collect()
    }

    pub fn encode(&self) -> String {
        format!(
            "{}:{}:{}",
            self.anchor_video,
            self.anchor_length,
            self.bits.encode()
        )
    }
}

/// A library item as Stremio holds it.
///
/// Kept as the document it arrived as: it carries fields the Host has no use for
/// (`temp`, `removed`, `behaviorHints`, the notification flags), and writing it
/// back with only the fields the Host reads would erase them from the account.
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteItem {
    raw: Value,
}

impl RemoteItem {
    /// A library item, or why this is not one: it needs an `_id` and is an
    /// object.
    pub fn parse(raw: Value) -> Result<Self, SyncError> {
        let id = raw.get("_id").and_then(Value::as_str);
        if !raw.is_object() || id.is_none_or(str::is_empty) {
            return Err(SyncError::Malformed {
                detail: "a library item has no `_id`".to_owned(),
            });
        }
        Ok(Self { raw })
    }

    /// A library item for a Title the account has never held.
    fn created(latest: &WatchProgress, now: i64) -> Self {
        let stamp = iso_from_millis(now);
        Self {
            raw: json!({
                "_id": latest.title.id(),
                "name": latest.title.name(),
                "type": latest.title.r#type(),
                "poster": latest.title.poster().unwrap_or(""),
                "posterShape": "poster",
                "removed": false,
                "temp": false,
                "_ctime": stamp,
                "_mtime": stamp,
                "state": {
                    "lastWatched": null,
                    "timeWatched": 0,
                    "timeOffset": 0,
                    "overallTimeWatched": 0,
                    "timesWatched": 0,
                    "flaggedWatched": 0,
                    "duration": 0,
                    "video_id": null,
                    "watched": null,
                    "noNotif": false
                },
                "behaviorHints": {}
            }),
        }
    }

    /// The document, to be written back.
    pub fn into_value(self) -> Value {
        self.raw
    }

    pub fn id(&self) -> &str {
        self.raw
            .get("_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    /// When the item was last modified, in milliseconds since the Unix epoch.
    pub fn mtime(&self) -> Option<i64> {
        self.raw
            .get("_mtime")
            .and_then(Value::as_str)
            .and_then(millis_from_iso)
    }

    /// The Video the account last played in this Title.
    pub fn video_id(&self) -> Option<&str> {
        let state = self.raw.get("state")?;
        state
            .get("video_id")
            .or_else(|| state.get("videoId"))
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
    }

    /// How far into it, in seconds — `None` where it was left at the start.
    pub fn offset_seconds(&self) -> Option<f64> {
        self.number("timeOffset")
            .filter(|millis| *millis > 0.0)
            .map(|millis| millis / 1000.0)
    }

    /// How long that Video is, in seconds, where Stremio knows.
    pub fn duration_seconds(&self) -> Option<f64> {
        self.number("duration")
            .filter(|millis| *millis > 0.0)
            .map(|millis| millis / 1000.0)
    }

    /// How many times the account has watched this Title through. For a film
    /// that is the watched bit; for a series it is a count, and the episodes are
    /// the bitfield's.
    pub fn times_watched(&self) -> u64 {
        self.number("timesWatched").map_or(0, |count| count as u64)
    }

    /// The episodes the account says are watched, where it says.
    pub fn watched(&self) -> Option<WatchedField> {
        self.raw
            .get("state")?
            .get("watched")?
            .as_str()
            .and_then(|text| WatchedField::parse(text).ok())
    }

    fn number(&self, field: &str) -> Option<f64> {
        self.raw.get("state")?.get(field)?.as_f64()
    }

    fn state(&mut self) -> &mut Map<String, Value> {
        let object = self
            .raw
            .as_object_mut()
            .expect("a library item is an object: parse() checked");
        if !object.get("state").is_some_and(Value::is_object) {
            object.insert("state".to_owned(), json!({}));
        }
        object
            .get_mut("state")
            .and_then(Value::as_object_mut)
            .expect("the state was just made an object")
    }

    /// Place the account's position at `entry`, as the Host last had it.
    fn place(&mut self, entry: &WatchProgress) {
        let key = if self.raw["state"].get("videoId").is_some() {
            "videoId"
        } else {
            "video_id"
        };
        let state = self.state();
        state.insert(key.to_owned(), json!(entry.video.id));
        state.insert(
            "timeOffset".to_owned(),
            json!(entry.position.map_or(0, seconds_to_millis)),
        );
        state.insert(
            "duration".to_owned(),
            json!(entry.duration.map_or(0, seconds_to_millis)),
        );
        state.insert(
            "lastWatched".to_owned(),
            json!(iso_from_millis(entry.updated_at)),
        );
    }

    fn mark_watched(&mut self, field: &WatchedField) {
        self.state()
            .insert("watched".to_owned(), json!(field.encode()));
    }

    fn mark_watched_once(&mut self) {
        self.state().insert("timesWatched".to_owned(), json!(1));
    }

    fn touch(&mut self, now: i64) {
        if let Some(object) = self.raw.as_object_mut() {
            object.insert("_mtime".to_owned(), json!(iso_from_millis(now)));
        }
    }
}

/// What a merge decided, for one Title.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Merged {
    /// Host entries that changed — to be written locally. A Video the account
    /// played that the Host had no entry for is among them, carried by the Title
    /// the Host already knows.
    pub local: Vec<WatchProgress>,
    /// The library item the account should hold now, or `None` where it already
    /// holds it.
    pub remote: Option<RemoteItem>,
}

/// Merge one Title's Watch progress with the account's library item for it.
///
/// - `local` is every entry the Host has in the Title; with none, there is no
///   card to draw anything from and nothing to merge.
/// - `remote` is the account's item, where it has one.
/// - `order` is the Title's Videos in the Addon's order, where the Host could
///   get it. It is what places an episode in the bitfield, so without it the
///   bitfield is left alone and only positions are merged.
/// - `now` stamps what is written to the account.
///
/// **Positions** go to whichever side wrote last. The account's position is
/// pulled into the Video it names when it is newer than the Host's entry for that
/// Video; the Host's most recent entry is pushed when it is newer than the
/// account's item. **Watched** is a union: an episode watched on either side is
/// watched on both, and no position ever clears it.
pub fn merge(
    local: &[WatchProgress],
    remote: Option<&RemoteItem>,
    order: Option<&[String]>,
    now: i64,
) -> Merged {
    let Some(latest) = local.iter().max_by_key(|entry| entry.updated_at) else {
        return Merged::default();
    };
    let remote_time = remote.and_then(RemoteItem::mtime).unwrap_or(0);
    let mut entries = local.to_vec();
    let mut changed: Vec<usize> = Vec::new();

    // The account's position, pulled in where it is newer than the Host's.
    if let (Some(remote), Some(video_id)) = (remote, remote.and_then(RemoteItem::video_id)) {
        let held = entries.iter().position(|entry| entry.video.id == video_id);
        let newer = held.is_none_or(|at| remote_time > entries[at].updated_at);
        let position = remote.offset_seconds();
        let duration = remote.duration_seconds();

        if newer {
            match held {
                Some(at) => {
                    let entry = &mut entries[at];
                    if differs(entry.position, position) || differs(entry.duration, duration) {
                        entry.position = position;
                        entry.duration = duration.or(entry.duration);
                        entry.watched |= position
                            .zip(entry.duration)
                            .is_some_and(|(at, of)| finished(at, of));
                        entry.updated_at = remote_time;
                        changed.push(at);
                    }
                }
                None => {
                    if let Ok(video) = VideoRef::parse(&latest.video.r#type, video_id) {
                        let mut entry = WatchProgress::starting(
                            video,
                            latest.title.clone(),
                            position,
                            remote_time,
                        );
                        entry.duration = duration;
                        entry.watched = position
                            .zip(duration)
                            .is_some_and(|(at, of)| finished(at, of));
                        entries.push(entry);
                        changed.push(entries.len() - 1);
                    }
                }
            }
        }
    }

    let mut item = remote
        .cloned()
        .unwrap_or_else(|| RemoteItem::created(latest, now));
    let mut dirty = remote.is_none();

    // The Host's most recent position, pushed where it is newer than the
    // account's. Judged on the entry as it was *before* the pull above: a pull
    // is for a Video the account wrote later than the Host, and a push is for
    // one the Host wrote later than the account, so they never name one Video.
    if latest.updated_at > remote_time {
        let same = item.video_id() == Some(latest.video.id.as_str())
            && !differs(item.offset_seconds(), latest.position)
            && !differs(item.duration_seconds(), latest.duration);
        if !same {
            item.place(latest);
            dirty = true;
        }
    }

    // What is watched: the union, in both directions.
    let movie = latest.title.r#type() == "movie";
    if movie {
        let watched = entries.iter().any(|entry| entry.watched);
        if item.times_watched() > 0 && !watched {
            if let Some(at) = entries.iter().position(|_| true) {
                entries[at].watched = true;
                changed.push(at);
            }
        } else if watched && item.times_watched() == 0 {
            item.mark_watched_once();
            dirty = true;
        }
    } else if let Some(order) = order {
        let on_account = remote
            .and_then(RemoteItem::watched)
            .map(|field| field.resolve(order))
            .unwrap_or_else(|| vec![false; order.len()]);

        for (index, video) in order.iter().enumerate() {
            let held = entries.iter().position(|entry| entry.video.id == *video);
            if let Some(at) = held {
                if on_account[index] && !entries[at].watched {
                    entries[at].watched = true;
                    changed.push(at);
                }
            }
        }

        let union: Vec<bool> = order
            .iter()
            .enumerate()
            .map(|(index, video)| {
                on_account[index]
                    || entries
                        .iter()
                        .any(|entry| entry.video.id == *video && entry.watched)
            })
            .collect();
        if union != on_account {
            item.mark_watched(&WatchedField::from_flags(&union, order));
            dirty = true;
        }
    }

    changed.sort_unstable();
    changed.dedup();
    if dirty {
        item.touch(now);
    }

    Merged {
        local: changed.into_iter().map(|at| entries[at].clone()).collect(),
        remote: dirty.then_some(item),
    }
}

/// Whether two positions are two places — within [`SAME_POSITION`] is the same.
fn differs(one: Option<f64>, other: Option<f64>) -> bool {
    match (one, other) {
        (None, None) => false,
        (Some(one), Some(other)) => (one - other).abs() > SAME_POSITION,
        _ => true,
    }
}

fn seconds_to_millis(seconds: f64) -> i64 {
    (seconds * 1000.0).round() as i64
}

/// Milliseconds since the Unix epoch, as Stremio writes a time: ISO 8601, UTC.
pub fn iso_from_millis(millis: i64) -> String {
    let days = millis.div_euclid(86_400_000);
    let of_day = millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        of_day / 3_600_000,
        of_day / 60_000 % 60,
        of_day / 1000 % 60,
        of_day % 1000
    )
}

/// The inverse: an ISO 8601 UTC time as milliseconds since the Unix epoch.
///
/// Only the form Stremio writes — `2020-01-01T00:00:00.000Z`, the fraction
/// optional, `Z` or `+00:00` for the zone. Anything else is `None`: a time this
/// Host cannot place is one it will not compare against.
pub fn millis_from_iso(text: &str) -> Option<i64> {
    let text = text
        .strip_suffix('Z')
        .or_else(|| text.strip_suffix("+00:00"))?;
    let (date, time) = text.split_once('T')?;
    let mut date = date.split('-');
    let year: i64 = date.next()?.parse().ok()?;
    let month: i64 = date.next()?.parse().ok()?;
    let day: i64 = date.next()?.parse().ok()?;
    let (clock, fraction) = time.split_once('.').unwrap_or((time, ""));
    let mut clock = clock.split(':');
    let hour: i64 = clock.next()?.parse().ok()?;
    let minute: i64 = clock.next()?.parse().ok()?;
    let second: i64 = clock.next()?.parse().ok()?;
    if date.next().is_some()
        || clock.next().is_some()
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
        || !fraction.chars().all(|digit| digit.is_ascii_digit())
    {
        return None;
    }
    let millis: i64 = format!("{fraction:0<3}")[..3].parse().ok()?;

    Some(
        days_from_civil(year, month, day) * 86_400_000
            + hour * 3_600_000
            + minute * 60_000
            + second * 1000
            + millis,
    )
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_from_march = (month + 9) % 12;
    let day_of_year = (153 * month_from_march + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_from_march = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_from_march + 2) / 5 + 1;
    let month = if month_from_march < 10 {
        month_from_march + 3
    } else {
        month_from_march - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::addon::AddonId;
    use crate::progress::{TitleCard, TitleStub};

    const JAN_2020: i64 = 1_577_836_800_000;

    fn stub(kind: &str, id: &str) -> TitleStub {
        TitleStub::parse(&TitleCard {
            addon: AddonId::parse("com.linvo.cinemeta").expect("an Addon id"),
            id: id.to_owned(),
            r#type: kind.to_owned(),
            name: "Breaking Bad".to_owned(),
            poster: None,
            background: None,
        })
        .expect("a card the Host will keep")
    }

    fn episode(number: u32, position: f64, watched: bool, at: i64) -> WatchProgress {
        let id = format!("tt0903747:1:{number}");
        WatchProgress {
            video: VideoRef::parse("series", &id).expect("a Video"),
            title: stub("series", "tt0903747"),
            position: Some(position),
            duration: Some(2820.0),
            watched,
            updated_at: at,
        }
    }

    fn order() -> Vec<String> {
        (1..=6).map(|n| format!("tt0903747:1:{n}")).collect()
    }

    fn account(video: &str, offset_ms: i64, mtime: i64, watched: &[usize]) -> RemoteItem {
        let flags: Vec<bool> = (0..6).map(|i| watched.contains(&i)).collect();
        RemoteItem::parse(json!({
            "_id": "tt0903747", "name": "Breaking Bad", "type": "series",
            "removed": false, "temp": false, "_mtime": iso_from_millis(mtime),
            "behaviorHints": { "defaultVideoId": null },
            "state": {
                "video_id": video, "timeOffset": offset_ms, "duration": 2_820_000,
                "timesWatched": 3, "noNotif": true,
                "watched": WatchedField::from_flags(&flags, &order()).encode(),
            }
        }))
        .expect("a library item")
    }

    fn pushed_flags(merged: &Merged) -> Vec<bool> {
        merged
            .remote
            .as_ref()
            .and_then(RemoteItem::watched)
            .expect("a watched field was pushed")
            .resolve(&order())
    }

    #[test]
    fn a_time_is_read_and_written_the_way_stremio_writes_it() {
        assert_eq!(millis_from_iso("2020-01-01T00:00:00.000Z"), Some(JAN_2020));
        assert_eq!(millis_from_iso("2020-01-01T00:00:00Z"), Some(JAN_2020));
        assert_eq!(
            millis_from_iso("2020-01-01T00:00:00.5Z"),
            Some(JAN_2020 + 500)
        );
        assert_eq!(
            iso_from_millis(JAN_2020 + 1_234),
            "2020-01-01T00:00:01.234Z"
        );
        assert_eq!(iso_from_millis(0), "1970-01-01T00:00:00.000Z");
        let leap = 1_709_210_096_789;
        assert_eq!(millis_from_iso(&iso_from_millis(leap)), Some(leap));
        assert_eq!(millis_from_iso("yesterday"), None);
        assert_eq!(millis_from_iso("2020-13-01T00:00:00Z"), None);
    }

    #[test]
    fn a_bitfield_survives_the_round_trip_and_reads_least_significant_bit_first() {
        let mut bits = BitField::default();
        bits.set(0, true);
        bits.set(9, true);

        let back = BitField::decode(&bits.encode()).expect("what was encoded decodes");

        assert!(back.get(0) && back.get(9));
        assert!(!back.get(1) && !back.get(8) && !back.get(500));
        // Stremio's own: `tt2934286:1:5:5:eJyTZwAAAEAAIA==` is a bitfield with
        // the first five bits set.
        let field =
            WatchedField::parse("tt2934286:1:5:5:eJyTZwAAAEAAIA==").expect("a field Stremio wrote");
        assert_eq!(field.anchor_video, "tt2934286:1:5");
        assert_eq!(field.anchor_length, 5);
    }

    #[test]
    fn a_field_that_is_not_one_is_refused_rather_than_guessed_at() {
        for broken in ["", "tt1:1", "tt1:x:abc", "tt1:1:!!!", "tt1:1:aGVsbG8="] {
            assert!(WatchedField::parse(broken).is_err(), "{broken:?}");
        }
    }

    #[test]
    fn a_field_is_realigned_when_the_addons_list_moves_under_it() {
        let written: Vec<String> = ["a", "b", "c"].map(str::to_owned).to_vec();
        let field = WatchedField::from_flags(&[true, true, false], &written);
        assert_eq!(field.anchor_video, "b");
        assert_eq!(field.anchor_length, 2);

        let grown: Vec<String> = ["new", "a", "b", "c"].map(str::to_owned).to_vec();
        assert_eq!(
            field.resolve(&grown),
            vec![false, true, true, false],
            "an episode added before them moves the watched ones with it"
        );
        let gone: Vec<String> = ["x", "y"].map(str::to_owned).to_vec();
        assert_eq!(field.resolve(&gone), vec![true, true]);
    }

    #[test]
    fn a_position_the_account_wrote_later_is_pulled_in() {
        let local = [episode(2, 300.0, false, 1_000)];
        let remote = account("tt0903747:1:2", 900_000, 5_000, &[]);

        let merged = merge(&local, Some(&remote), Some(&order()), 9_000);

        assert_eq!(merged.local.len(), 1);
        assert_eq!(merged.local[0].position, Some(900.0));
        assert_eq!(merged.local[0].updated_at, 5_000);
        assert_eq!(
            merged.remote, None,
            "nothing here is newer than the account"
        );
    }

    #[test]
    fn a_position_the_host_wrote_later_is_pushed_out() {
        let local = [episode(2, 1500.0, false, 8_000)];
        let remote = account("tt0903747:1:2", 900_000, 5_000, &[]);

        let merged = merge(&local, Some(&remote), Some(&order()), 9_000);

        assert_eq!(merged.local, vec![]);
        let pushed = merged.remote.expect("the Host is newer");
        assert_eq!(pushed.offset_seconds(), Some(1500.0));
        assert_eq!(pushed.video_id(), Some("tt0903747:1:2"));
        assert_eq!(pushed.mtime(), Some(9_000));
    }

    #[test]
    fn a_tie_changes_nothing_on_either_side() {
        let local = [episode(2, 900.0, false, 5_000)];
        let remote = account("tt0903747:1:2", 900_000, 5_000, &[]);

        assert_eq!(
            merge(&local, Some(&remote), Some(&order()), 9_000),
            Merged::default()
        );
    }

    #[test]
    fn a_merge_that_has_already_happened_is_a_no_op() {
        let local = [episode(2, 900.0, false, 1_000)];
        let remote = account("tt0903747:1:2", 900_000, 5_000, &[]);

        // The account is newer, but says what the Host says: not worth a write.
        assert_eq!(
            merge(&local, Some(&remote), Some(&order()), 9_000),
            Merged::default()
        );
    }

    #[test]
    fn a_video_the_account_played_that_the_host_did_not_is_picked_up() {
        let local = [episode(2, 300.0, false, 1_000)];
        let remote = account("tt0903747:1:5", 600_000, 5_000, &[]);

        let merged = merge(&local, Some(&remote), Some(&order()), 9_000);

        let picked = merged.local.last().expect("an entry for episode 5");
        assert_eq!(picked.video.id, "tt0903747:1:5");
        assert_eq!(picked.position, Some(600.0));
        assert_eq!(
            picked.title, local[0].title,
            "drawn from the Title the Host knows"
        );
    }

    #[test]
    fn each_video_resolves_by_its_own_time_so_an_older_remote_video_still_lands() {
        // The Host has played episode 3 since; the account's position, in
        // episode 2, is older than that but newer than the Host's episode 2.
        let local = [
            episode(2, 100.0, false, 1_000),
            episode(3, 200.0, false, 8_000),
        ];
        let remote = account("tt0903747:1:2", 900_000, 5_000, &[]);

        let merged = merge(&local, Some(&remote), Some(&order()), 9_000);

        assert_eq!(merged.local.len(), 1);
        assert_eq!(merged.local[0].video.id, "tt0903747:1:2");
        assert_eq!(merged.local[0].position, Some(900.0));
        let pushed = merged.remote.expect("episode 3 is the newest write");
        assert_eq!(pushed.video_id(), Some("tt0903747:1:3"));
    }

    #[test]
    fn watched_episodes_are_the_union_of_both_sides_and_not_the_newer_one() {
        // The account has episodes 1-2; the Host finished episode 4 — and the
        // Host's write is the newer, which a newest-wins merge of the field
        // would use to throw 1-2 away.
        let local = [episode(4, 2820.0, true, 8_000)];
        let remote = account("tt0903747:1:2", 0, 5_000, &[0, 1]);

        let merged = merge(&local, Some(&remote), Some(&order()), 9_000);

        assert_eq!(
            pushed_flags(&merged),
            vec![true, true, false, true, false, false]
        );
    }

    #[test]
    fn episodes_the_account_watched_mark_the_hosts_entries_watched() {
        // The account is the newer, and has episode 3 watched.
        let local = [episode(3, 400.0, false, 1_000)];
        let remote = account("tt0903747:1:6", 0, 5_000, &[2]);

        let merged = merge(&local, Some(&remote), Some(&order()), 9_000);

        let pulled = merged
            .local
            .iter()
            .find(|entry| entry.video.id == "tt0903747:1:3")
            .expect("episode 3 was marked");
        assert!(pulled.watched);
        assert_eq!(
            pulled.position,
            Some(400.0),
            "a mark does not move a position"
        );
    }

    #[test]
    fn a_position_written_later_never_clears_the_watched_field() {
        let local = [episode(5, 120.0, false, 8_000)];
        let remote = account("tt0903747:1:4", 0, 5_000, &[0, 1, 2, 3]);

        let merged = merge(&local, Some(&remote), Some(&order()), 9_000);

        let pushed = merged.remote.expect("the Host is newer");
        assert_eq!(pushed.video_id(), Some("tt0903747:1:5"));
        assert_eq!(
            pushed.watched().expect("still there").resolve(&order()),
            vec![true, true, true, true, false, false],
            "the field was not touched by a position"
        );
    }

    #[test]
    fn what_the_account_holds_that_the_host_does_not_read_is_written_back_intact() {
        let local = [episode(2, 1500.0, false, 8_000)];
        let remote = account("tt0903747:1:2", 900_000, 5_000, &[]);

        let pushed = merge(&local, Some(&remote), Some(&order()), 9_000)
            .remote
            .expect("the Host is newer")
            .into_value();

        assert_eq!(pushed["behaviorHints"], json!({ "defaultVideoId": null }));
        assert_eq!(pushed["state"]["noNotif"], json!(true));
        assert_eq!(pushed["state"]["timesWatched"], json!(3));
        assert_eq!(pushed["removed"], json!(false));
    }

    #[test]
    fn a_title_the_account_has_never_held_is_created_there() {
        let local = [episode(2, 600.0, true, 8_000)];

        let merged = merge(&local, None, Some(&order()), 9_000);

        let created = merged.remote.expect("a new library item");
        assert_eq!(created.id(), "tt0903747");
        assert_eq!(created.video_id(), Some("tt0903747:1:2"));
        assert_eq!(created.offset_seconds(), Some(600.0));
        assert_eq!(
            created
                .watched()
                .expect("episode 2 is watched")
                .resolve(&order()),
            vec![false, true, false, false, false, false]
        );
        let value = created.into_value();
        assert_eq!(value["removed"], json!(false));
        assert_eq!(value["name"], json!("Breaking Bad"));
    }

    #[test]
    fn without_the_titles_list_only_positions_are_merged() {
        let local = [episode(4, 2820.0, true, 8_000)];
        let remote = account("tt0903747:1:2", 0, 5_000, &[0, 1]);

        let merged = merge(&local, Some(&remote), None, 9_000);

        let pushed = merged.remote.expect("the Host is newer");
        assert_eq!(
            pushed.watched().expect("untouched").resolve(&order()),
            vec![true, true, false, false, false, false],
            "no place for episode 4 in the field, so the field is left as it was"
        );
    }

    #[test]
    fn a_film_is_watched_by_a_count_not_a_field() {
        let film = |watched: bool, at: i64| WatchProgress {
            video: VideoRef::parse("movie", "tt0133093").expect("a Video"),
            title: stub("movie", "tt0133093"),
            position: Some(8000.0),
            duration: Some(8160.0),
            watched,
            updated_at: at,
        };
        let held = |times: u64| {
            RemoteItem::parse(json!({
                "_id": "tt0133093", "type": "movie", "_mtime": iso_from_millis(5_000),
                "state": { "video_id": "tt0133093", "timeOffset": 8_000_000,
                           "duration": 8_160_000, "timesWatched": times }
            }))
            .expect("a library item")
        };

        let pushed = merge(&[film(true, 1_000)], Some(&held(0)), None, 9_000);
        assert_eq!(pushed.remote.expect("marked watched").times_watched(), 1);

        let pulled = merge(&[film(false, 1_000)], Some(&held(2)), None, 9_000);
        assert!(pulled.local[0].watched);
    }

    #[test]
    fn a_title_with_no_host_entries_merges_nothing() {
        let remote = account("tt0903747:1:2", 900_000, 5_000, &[0]);

        assert_eq!(
            merge(&[], Some(&remote), Some(&order()), 9_000),
            Merged::default()
        );
    }

    #[test]
    fn a_library_item_with_no_id_is_not_one() {
        assert!(RemoteItem::parse(json!({ "name": "x" })).is_err());
        assert!(RemoteItem::parse(json!("x")).is_err());
    }
}

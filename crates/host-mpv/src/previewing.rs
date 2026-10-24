//! What the preview worker tells mpv, in mpv's own vocabulary.
//!
//! The pure half of the second, silent Player: the options a worker starts with,
//! the filter chain a frame is scaled and — where it is HDR — tonemapped by, and
//! the commands that ask for one still. All of it is a list or a string, so what
//! a preview costs mpv is a decision tested without a player (ADR-0028).

use std::time::Duration;

use host_core::bucket_start;

/// The filter chain an SDR frame is scaled by. Nothing is converted: the frame
/// the Stream carries is the frame the tooltip shows. 320 pixels wide — a still
/// of about ten kilobytes, which is what a tooltip can afford and a phone's
/// socket can carry (ADR-0028).
pub(crate) const SDR_FILTERS: &str = "scale=320:-2";

/// The chain an HDR frame is brought to BT.709 by before it is encoded.
///
/// A PQ/BT.2020 still drawn into an `<img>` is grey and washed out, and it would
/// be the only part of the product that looks broken on the content the product
/// exists for: HDR passthrough (ADR-0003, ADR-0028). `zscale` does the matrix and
/// the transfer, `tonemap` brings the peak down, and the last `zscale` states the
/// BT.709 output explicitly. SDR never installs it and pays nothing.
pub(crate) const TONEMAP_FILTERS: &str = "zscale=t=linear:npl=100,format=gbrpf32le,\
     zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,scale=320:-2,\
     format=yuv420p";

/// How long a worker waits for a frame to exist before giving up.
///
/// `time-pos` is already at the target when `seek` returns; the frames only exist
/// after `MPV_EVENT_PLAYBACK_RESTART`. The container measured about 3 ms for a
/// local file and 27 ms once a filter chain is installed, so three seconds is
/// generous — and a timeout is a still that never comes, drawn as absence.
pub(crate) const READY_TIMEOUT_SECONDS: f64 = 3.0;

/// How long a worker keeps its connection after the last still.
///
/// The connection is the thing to ration: it is a second connection to a debrid
/// URL. A burst of hovering pays one connection, and a burst that begins again
/// after a pause pays another; the stills already taken stay in memory either
/// way (ADR-0028).
pub(crate) const RELEASE_AFTER_IDLE: Duration = Duration::from_secs(30);

/// How much of the Stream the worker keeps read ahead: a seek's own neighbourhood,
/// not the film. A decorative worker has no business holding a Stream's worth of
/// bytes in memory.
pub(crate) const DEMUXER_MAX_BYTES: &str = "32MiB";

/// The same, for the part behind the read position.
pub(crate) const DEMUXER_MAX_BACK_BYTES: &str = "8MiB";

/// The options the second, silent instance is started with.
///
/// No picture (`vo=null`), no sound (`ao=null`), neither track selected, no
/// user's configuration to inherit (`config=no`), and no on-screen controls: a
/// frame is the only thing that leaves it. `keep-open` keeps the last frame
/// loaded, which is what lets a screenshot be taken after `idle` would have
/// unloaded it, and `idle` lets the instance exist before a file does.
///
/// The screenshot options are the Host's own: JPEG at 90, and no high bit depth —
/// a still that has to travel through a `<img>` in a browser has no room for one,
/// and the tone map has already brought the colour back.
pub(crate) fn options() -> Vec<(&'static str, String)> {
    vec![
        ("vo", "null".to_owned()),
        ("ao", "null".to_owned()),
        ("aid", "no".to_owned()),
        ("sid", "no".to_owned()),
        ("config", "no".to_owned()),
        ("idle", "yes".to_owned()),
        ("keep-open", "yes".to_owned()),
        ("osc", "no".to_owned()),
        ("input-default-bindings", "no".to_owned()),
        ("demuxer-max-bytes", DEMUXER_MAX_BYTES.to_owned()),
        ("demuxer-max-back-bytes", DEMUXER_MAX_BACK_BYTES.to_owned()),
        // The filter chain is installed as an option rather than as a command:
        // a still is scaled from the moment the file loads, and the HDR chain is
        // re-installed only where the frame turns out to need it.
        ("vf", SDR_FILTERS.to_owned()),
        ("screenshot-format", "jpg".to_owned()),
        ("screenshot-jpeg-quality", "90".to_owned()),
        ("screenshot-high-bit-depth", "no".to_owned()),
    ]
}

/// Whether a frame's own `video-params` say it is HDR.
///
/// A PQ or HLG transfer is the definition; `bt.2020` primaries without one are
/// HDR primaries still, and the app exists to pass such a frame through (ADR-0003,
/// ADR-0028). Anything else is SDR, which is left alone.
pub(crate) fn high_dynamic_range(primaries: Option<&str>, gamma: Option<&str>) -> bool {
    let gamma = gamma.map(str::to_ascii_lowercase);
    let primaries = primaries.map(str::to_ascii_lowercase);

    matches!(gamma.as_deref(), Some("pq" | "hlg"))
        || matches!(primaries.as_deref(), Some("bt.2020"))
}

/// The filter chain a frame with these properties is taken through.
pub(crate) fn filters(primaries: Option<&str>, gamma: Option<&str>) -> &'static str {
    if high_dynamic_range(primaries, gamma) {
        TONEMAP_FILTERS
    } else {
        SDR_FILTERS
    }
}

/// Whether a worker last used this long ago has been idle long enough to let its
/// connection go.
pub(crate) fn release_after_idle(idle: Duration) -> bool {
    idle >= RELEASE_AFTER_IDLE
}

/// Where a worker seeks for a bucket: the bucket's own start.
///
/// Seeking to the moment asked for would land between keyframes and cost the
/// same bytes; seeking to where the bucket begins is one place per five seconds
/// and the still is at most four seconds from the pointer (ADR-0028).
pub(crate) fn seek_target(bucket: u64) -> f64 {
    bucket_start(bucket)
}

/// The `loadfile` a worker opens the Stream with, at the moment it begins at.
///
/// A Stream is opened once per armed URL; every still after the first is a seek
/// on the same load, so a burst of hovering pays one connection and one open.
pub(crate) fn load(url: &str, at: f64) -> (&'static str, Vec<String>) {
    (
        "loadfile",
        vec![url.to_owned(), "replace".to_owned(), format!("start={at}")],
    )
}

/// The `seek` that moves a loaded Stream to a bucket, absolutely.
pub(crate) fn seek(at: f64) -> (&'static str, Vec<String>) {
    ("seek", vec![at.to_string(), "absolute".to_owned()])
}

/// Ask mpv for one still of the frame at the current position, without subtitles
/// or anything else drawn over it.
pub(crate) fn screenshot(path: &str) -> (&'static str, Vec<String>) {
    (
        "screenshot-to-file",
        vec![path.to_owned(), "video".to_owned()],
    )
}

/// The file name a still is written under: its bucket, so a directory left
/// behind by a killed process says which moments it was taking.
pub(crate) fn still_path(directory: &std::path::Path, bucket: u64) -> std::path::PathBuf {
    directory.join(format!("{bucket}.jpg"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option<'a>(options: &'a [(&'static str, String)], name: &str) -> Option<&'a str> {
        options
            .iter()
            .find(|(option, _)| *option == name)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn a_worker_draws_nowhere_and_says_nothing() {
        let options = options();

        assert_eq!(option(&options, "vo"), Some("null"));
        assert_eq!(option(&options, "ao"), Some("null"));
        assert_eq!(option(&options, "aid"), Some("no"));
        assert_eq!(option(&options, "sid"), Some("no"));
        assert_eq!(option(&options, "osc"), Some("no"));
    }

    #[test]
    fn a_worker_inherits_no_configuration_and_waits_idle_for_a_file() {
        let options = options();

        assert_eq!(
            option(&options, "config"),
            Some("no"),
            "a preview is not the owner's mpv configuration"
        );
        assert_eq!(option(&options, "idle"), Some("yes"));
        assert_eq!(
            option(&options, "keep-open"),
            Some("yes"),
            "the last frame stays loaded long enough to be taken"
        );
    }

    #[test]
    fn a_worker_keeps_only_a_seeks_neighbourhood_in_memory() {
        let options = options();

        assert_eq!(option(&options, "demuxer-max-bytes"), Some("32MiB"));
        assert_eq!(option(&options, "demuxer-max-back-bytes"), Some("8MiB"));
    }

    #[test]
    fn a_still_is_a_320_pixel_jpeg_at_ninety() {
        let options = options();

        assert_eq!(option(&options, "vf"), Some(SDR_FILTERS));
        assert_eq!(option(&options, "screenshot-format"), Some("jpg"));
        assert_eq!(
            option(&options, "screenshot-jpeg-quality"),
            Some("90"),
            "a tooltip's still is small and still worth looking at"
        );
        assert_eq!(
            option(&options, "screenshot-high-bit-depth"),
            Some("no"),
            "an <img> in a browser takes eight bits a channel"
        );
        assert!(
            SDR_FILTERS.contains("scale=320"),
            "the still is scaled before it is encoded: {SDR_FILTERS}"
        );
    }

    #[test]
    fn hdr_is_a_pq_or_hlg_transfer_or_bt2020_primaries() {
        assert!(high_dynamic_range(None, Some("pq")));
        assert!(high_dynamic_range(None, Some("HLG")));
        assert!(high_dynamic_range(Some("bt.2020"), None));
        assert!(high_dynamic_range(Some("bt.2020"), Some("pq")));

        assert!(!high_dynamic_range(Some("bt.709"), Some("bt.1886")));
        assert!(!high_dynamic_range(None, None));
    }

    #[test]
    fn only_an_hdr_frame_pays_for_the_tonemap_chain() {
        assert_eq!(filters(Some("bt.709"), Some("bt.1886")), SDR_FILTERS);
        assert_eq!(filters(None, None), SDR_FILTERS);

        let chain = filters(Some("bt.2020"), Some("pq"));
        assert_eq!(chain, TONEMAP_FILTERS);
        assert!(
            chain.contains("zscale") && chain.contains("tonemap"),
            "the HDR chain converts before it scales: {chain}"
        );
        assert!(
            chain.contains("scale=320"),
            "an HDR still is the same size as an SDR one: {chain}"
        );
    }

    #[test]
    fn a_bucket_is_sought_to_where_it_begins() {
        assert_eq!(seek_target(0), 0.0);
        assert_eq!(seek_target(3), 15.0);
    }

    #[test]
    fn the_stream_is_opened_at_the_bucket_it_is_first_asked_about() {
        let (command, arguments) = load("https://stream.example.org/a.mkv", 15.0);

        assert_eq!(command, "loadfile");
        assert_eq!(
            arguments,
            vec![
                "https://stream.example.org/a.mkv".to_owned(),
                "replace".to_owned(),
                "start=15".to_owned()
            ],
            "the first still begins where the bucket begins rather than at 0:00"
        );
    }

    #[test]
    fn a_later_bucket_is_a_seek_on_the_load_that_is_already_open() {
        let (command, arguments) = seek(15.0);

        assert_eq!(command, "seek");
        assert_eq!(arguments, vec!["15".to_owned(), "absolute".to_owned()]);
    }

    #[test]
    fn the_still_is_asked_for_without_subtitles_or_anything_drawn_over_it() {
        let (command, arguments) = screenshot("/tmp/a.jpg");

        assert_eq!(command, "screenshot-to-file");
        assert_eq!(
            arguments,
            vec!["/tmp/a.jpg".to_owned(), "video".to_owned()],
            "the mode is the picture, not the window it is drawn in"
        );
    }

    #[test]
    fn a_still_is_named_after_its_bucket() {
        let path = still_path(std::path::Path::new("/tmp/streamingapp-preview-1"), 7);

        assert_eq!(path.to_string_lossy(), "/tmp/streamingapp-preview-1/7.jpg");
    }

    #[test]
    fn a_worker_lets_its_connection_go_after_half_a_minute_without_a_still() {
        assert!(!release_after_idle(Duration::ZERO));
        assert!(!release_after_idle(
            RELEASE_AFTER_IDLE - Duration::from_secs(1)
        ));
        assert!(release_after_idle(RELEASE_AFTER_IDLE));
        assert!(release_after_idle(
            RELEASE_AFTER_IDLE + Duration::from_secs(60)
        ));
    }
}

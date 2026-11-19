//! The Hand pick: what the Host remembers of a Track a client selected during
//! playback, while the Title keeps playing (ADR-0041).
//!
//! It is kept as a language, or as "off", and never as a Track id: the next
//! file's Tracks are not numbered like this one's. It is Host state keyed by the
//! Title it was made in, ahead of the lists in both choices, and it ends on stop
//! and on the play of another Title. It is not stored, so a restart forgets it,
//! and it is not published, so no Snapshot says it. It never touches the lists.

use crate::preferences::Language;
use crate::tracks::SubtitleHandPick;

/// The picks made during one Title: a soundtrack's language and a subtitle's.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Picks {
    /// The Title the picks were made in, by its id.
    title: String,
    audio: Option<Language>,
    subtitle: Option<SubtitleHandPick>,
}

/// Whether a Hand pick is held, and what it is. Empty at every Host start.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct HandPick {
    held: Option<Picks>,
}

impl HandPick {
    /// The soundtrack language picked, to be chosen ahead of Audio languages.
    pub(crate) fn audio(&self) -> Option<&Language> {
        self.held.as_ref()?.audio.as_ref()
    }

    /// The subtitle picked — a language, or off — to be chosen ahead of
    /// Subtitle languages.
    pub(crate) fn subtitle(&self) -> Option<&SubtitleHandPick> {
        self.held.as_ref()?.subtitle.as_ref()
    }

    /// A soundtrack picked in this Title. A Track that names no language leaves
    /// nothing to carry, and any earlier pick where it was.
    pub(crate) fn picked_audio(&mut self, title: &str, language: Option<Language>) {
        if let Some(language) = language {
            self.picks_for(title).audio = Some(language);
        }
    }

    /// A subtitle picked in this Title: off, or the Track's language. `None`
    /// is a Track that names no language, which leaves nothing to carry, and
    /// any earlier pick where it was.
    pub(crate) fn picked_subtitle(&mut self, title: &str, pick: Option<SubtitleHandPick>) {
        if let Some(pick) = pick {
            self.picks_for(title).subtitle = Some(pick);
        }
    }

    /// A Stream of this Title starts (`None` where the Host was never told one):
    /// the picks stay for the same Title and end for any other.
    pub(crate) fn played(&mut self, title: Option<&str>) {
        if self.held.as_ref().map(|held| held.title.as_str()) != title {
            self.held = None;
        }
    }

    /// Playback stopped: nothing is carried.
    pub(crate) fn stopped(&mut self) {
        self.held = None;
    }

    /// The picks of this Title, started empty if the Host held another's.
    fn picks_for(&mut self, title: &str) -> &mut Picks {
        if self.held.as_ref().map(|held| held.title.as_str()) != Some(title) {
            self.held = Some(Picks {
                title: title.to_owned(),
                audio: None,
                subtitle: None,
            });
        }
        self.held
            .as_mut()
            .expect("the picks were just made for this Title")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn language(tag: &str) -> Language {
        Language::parse(tag).expect("a language tag")
    }

    #[test]
    fn nothing_is_held_to_begin_with() {
        let picks = HandPick::default();
        assert_eq!((picks.audio(), picks.subtitle()), (None, None));
    }

    #[test]
    fn a_pick_is_a_language_or_off() {
        let mut picks = HandPick::default();
        picks.picked_audio("tt1", Some(language("pt-BR")));
        picks.picked_subtitle("tt1", Some(SubtitleHandPick::Language(language("en"))));
        assert_eq!(picks.audio(), Some(&language("pt-BR")));
        assert_eq!(
            picks.subtitle(),
            Some(&SubtitleHandPick::Language(language("en")))
        );

        picks.picked_subtitle("tt1", Some(SubtitleHandPick::Off));
        assert_eq!(picks.subtitle(), Some(&SubtitleHandPick::Off));
    }

    #[test]
    fn a_track_with_no_language_records_nothing_and_leaves_an_earlier_pick() {
        let mut picks = HandPick::default();
        picks.picked_audio("tt1", None);
        picks.picked_subtitle("tt1", None);
        assert_eq!(picks, HandPick::default());

        picks.picked_subtitle("tt1", Some(SubtitleHandPick::Language(language("fr"))));
        picks.picked_subtitle("tt1", None);
        assert_eq!(
            picks.subtitle(),
            Some(&SubtitleHandPick::Language(language("fr")))
        );
    }

    #[test]
    fn the_same_title_keeps_the_picks_and_another_ends_them() {
        let mut picks = HandPick::default();
        picks.picked_audio("tt1", Some(language("ja")));
        picks.picked_subtitle("tt1", Some(SubtitleHandPick::Off));

        picks.played(Some("tt1"));
        assert_eq!(picks.audio(), Some(&language("ja")));
        assert_eq!(picks.subtitle(), Some(&SubtitleHandPick::Off));

        picks.played(Some("tt2"));
        assert_eq!(picks, HandPick::default());
    }

    #[test]
    fn a_play_of_no_known_title_ends_the_picks() {
        let mut picks = HandPick::default();
        picks.picked_subtitle("tt1", Some(SubtitleHandPick::Off));
        picks.played(None);
        assert_eq!(picks, HandPick::default());
    }

    #[test]
    fn a_stop_ends_the_picks() {
        let mut picks = HandPick::default();
        picks.picked_audio("tt1", Some(language("ja")));
        picks.stopped();
        assert_eq!(picks, HandPick::default());
    }

    #[test]
    fn a_pick_in_another_title_starts_afresh() {
        let mut picks = HandPick::default();
        picks.picked_audio("tt1", Some(language("ja")));
        picks.picked_subtitle("tt2", Some(SubtitleHandPick::Off));
        assert_eq!(picks.audio(), None, "the other Title's soundtrack is gone");
        assert_eq!(picks.subtitle(), Some(&SubtitleHandPick::Off));
    }
}

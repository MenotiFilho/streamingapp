import type { ActionError } from "./errors";
import type { Action, ContinueEntry, MetaPreview, Title, UpNextPlayback, Video } from "./wire";
import {
  isSeries,
  labelOf,
  releaseOf,
  seasonsOf,
  type Season,
} from "./title";

/**
 * The Title page's programme decisions, kept out of the drawing (ADR-0032).
 *
 * A Title is one screen: the facts a person reads before deciding, the brass
 * Unmapped mark when no TMDB record met it, what the right rail offers next — a
 * film's one action, or a series' seasons — and where a Continue watching Title
 * opens. The anchor and the main Resume control are the same decisions on both
 * clients; only the season a person folds out afterwards stays their own.
 */

/** One piece of the page's bookkeeping, in the record's printed order. */
export type TitleFact = {
  role: "rating" | "year" | "runtime" | "genre";
  text: string;
};

/**
 * The facts the programme page prints: IMDb, the year, the runtime, then the
 * Addon's genres. A fact the Host was not told is not printed, and the card a
 * person opened carries the year for a sparse meta answer (ADR-0011).
 */
export function titleFacts(
  title: Title,
  preview?: Partial<Pick<MetaPreview, "releaseInfo">> | null,
): TitleFact[] {
  const facts: TitleFact[] = [];
  const rating = title.imdbRating?.trim();
  if (rating) {
    facts.push({ role: "rating", text: `IMDb ${rating}` });
  }

  const year = releaseOf(title, preview)?.trim();
  if (year) {
    facts.push({ role: "year", text: year });
  }

  const runtime = title.runtime?.trim();
  if (runtime) {
    facts.push({ role: "runtime", text: runtime });
  }

  for (const genre of title.genres) {
    facts.push({ role: "genre", text: genre });
  }

  return facts;
}

/**
 * Whether the page stamps Unmapped: an Addon-keyed Title met no TMDB record, so
 * it is keyed by its Addon. The mark is a stamp, not an error — red stays
 * status-only (design record §9).
 */
export function unmappedOf(title: Title): boolean {
  return title.key.kind === "addon";
}

/**
 * What the right rail offers next: a film's one action, a series' season index,
 * or the honest note that a series listed no episodes (which must never read as
 * a film with one Video). A film prints only the action — no kicker, no note; the
 * audio/description column already said what the Title is.
 */
export type TitleSide =
  | { kind: "film" }
  | { kind: "series"; seasons: Season[] }
  | { kind: "series-empty"; kicker: string; note: string };

export function titleSide(title: Title): TitleSide {
  if (!isSeries(title)) {
    return { kind: "film" };
  }

  const seasons = seasonsOf(title);
  if (seasons.length === 0) {
    return {
      kind: "series-empty",
      kicker: "A series with no episodes",
      note: "This series' Addon listed no episodes, so there is nothing to ask Streams of.",
    };
  }

  return { kind: "series", seasons };
}

/**
 * The Title's Continue watching card, matched the way the Host groups it: by
 * the type and id the stub carries. The same series reached under two keys is
 * two cards there, and a Title opened under one key does not anchor to the
 * other (ADR-0020's hazard).
 */
function continueEntryOf(
  title: Pick<Title, "type" | "id">,
  continueWatching: readonly ContinueEntry[],
): ContinueEntry | null {
  return (
    continueWatching.find(
      (entry) => entry.title.type === title.type && entry.title.id === title.id,
    ) ?? null
  );
}

/**
 * Where a Title opens: the Video its Continue watching entry names, and the
 * season that Video is in, or the beginning when the Title has no entry.
 *
 * The entry is the Title's anchor wherever it was opened from — a card on
 * Home, a Discover row, a Search hit, the Library — because the decision reads
 * the Host's Continue watching list, not the card that was pressed (CONTEXT.md,
 * *Up next*). With no entry, the first season is shown and `video` is null: the
 * screen keeps the default focus it has today.
 *
 * The Video is the Title's own copy where the list holds it, so the name and
 * still the Title page draws come with it; a stale Title that does not list the
 * card's Video still anchors on the entry's own Video.
 */
export type TitleAnchor = {
  /** The season the Title page shows: the entry Video's, else the first. */
  season: number | null;
  /** The Video the page focuses, or null for the screen's default focus. */
  video: Video | null;
};

export function titleAnchor(
  title: Title,
  continueWatching: readonly ContinueEntry[],
): TitleAnchor {
  const entry = continueEntryOf(title, continueWatching);
  if (entry === null) {
    return { season: seasonsOf(title)[0]?.season ?? null, video: null };
  }

  const video =
    title.videos.find((held) => held.id === entry.video.id) ?? entry.video;
  return { season: video.season ?? null, video };
}

/** What the Title's main control is: the Resume it has today, or Play. */
export type TitleMainAction =
  | {
      kind: "resume";
      /** The words on the control: `Resume S1E3 · 12 min left`, or `Resume`. */
      label: string;
      /** The Action the control takes: the Host's own `resume`. */
      action: Extract<Action, { type: "resume" }>;
    }
  | {
      kind: "play";
      /** The words on the control: `Play S1E4`. */
      label: string;
      /** The Up next Video, which is also what a picker Play opens. */
      video: Video;
      /**
       * The Action a direct Play sends, or null where the preference makes
       * this a picker Play and the client opens the Streams for `video` itself.
       */
      action: Extract<Action, { type: "play_up_next" }> | null;
    };

/**
 * How much of a partly watched Video is left, in whole minutes, where the Host
 * knows the Video's length: the Title's main control. A Video with no length is
 * resumed without claiming a time nobody said.
 */
function timeLeftOf(entry: ContinueEntry): string | null {
  if (
    entry.position === null ||
    entry.duration === null ||
    entry.duration <= entry.position
  ) {
    return null;
  }

  const minutes = Math.max(1, Math.round((entry.duration - entry.position) / 60));
  return `${minutes} min left`;
}

/**
 * The Title's main control, or null where there is none.
 *
 * A partly watched Video resumes at the Host's saved position, and the
 * preference never reaches it: resuming stays one press. An Up next with no
 * position is Play: the Host reads which Video that is and continues the
 * release of the Video before it, unless the Up next preference makes the
 * owner choose — then the control still says Play, and the client opens the
 * Streams picker for that Video itself (#276). A finished Video, an unstarted
 * Video that is not an Up next, and a Title with no entry have no control.
 */
export function titleMainAction(
  title: Title,
  continueWatching: readonly ContinueEntry[],
  upNextPlayback: UpNextPlayback = "direct",
): TitleMainAction | null {
  const entry = continueEntryOf(title, continueWatching);
  if (entry === null) {
    return null;
  }

  const video = title.videos.find((held) => held.id === entry.video.id) ?? entry.video;

  // An Up next never started is Play, whatever the preference: the choice is
  // whether the Host plays it directly or the client opens the picker.
  if (entry.upNext && entry.position === null) {
    const episode = labelOf(video);
    return {
      kind: "play",
      label: episode ? `Play ${episode}` : "Play",
      video,
      action:
        upNextPlayback === "picker"
          ? null
          : { type: "play_up_next", title: { type: title.type, id: title.id } },
    };
  }

  if (entry.watched || entry.position === null) {
    return null;
  }

  const episode = labelOf(video);
  const left = timeLeftOf(entry);
  const base = episode ? `Resume ${episode}` : "Resume";

  return {
    kind: "resume",
    label: left ? `${base} · ${left}` : base,
    action: {
      type: "resume",
      video: { type: title.type, id: video.id },
    },
  };
}

/**
 * What pressing the Title's main control asks this client to do.
 *
 * The ladder is the same on both clients: Resume takes the Host's own
 * `resume`; a Play with continuity takes `play_up_next`; and a Play the
 * preference made a picker opens the Streams for the Up next in the client's
 * own stack. Keeping the choice here is what stops the window and the Remote
 * from disagreeing about it (ADR-0032).
 */
export type TitleMainPress =
  | { kind: "resume"; action: Extract<Action, { type: "resume" }> }
  | {
      kind: "play";
      action: Extract<Action, { type: "play_up_next" }>;
      video: Video;
    }
  | { kind: "picker"; video: Video };

export function titleMainPress(main: TitleMainAction | null): TitleMainPress | null {
  if (main === null) {
    return null;
  }
  if (main.kind === "resume") {
    return { kind: "resume", action: main.action };
  }
  if (main.action === null) {
    return { kind: "picker", video: main.video };
  }
  return { kind: "play", action: main.action, video: main.video };
}

/**
 * What a Play's answer came to: the player when the Host took it, the picker
 * for the Up next when continuity found no Stream, and the client's one alert
 * for anything else (#276). A Play that the preference already made a picker
 * never reaches this — it asked nothing.
 */
export type TitlePlayOutcome = "played" | "picker" | "report";

export function titlePlayOutcome(error: ActionError | null): TitlePlayOutcome {
  if (error === null) {
    return "played";
  }
  return error.kind === "no_up_next_stream" ? "picker" : "report";
}

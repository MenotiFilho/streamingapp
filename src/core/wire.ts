import type { ActionError } from "./errors";

/**
 * The version of the Action wire form this client speaks.
 * Mirrors `ACTION_VERSION` in `host-core`.
 */
export const ACTION_VERSION = 1;

/**
 * The event the Host publishes Snapshots on. Mirrors `SNAPSHOT_EVENT` in
 * `src-tauri/src/ipc.rs`.
 *
 * The #190 resolution put it on the Tauri adapter; it stays here because the
 * rehearsal's preview Host publishes on the same name, and moving it would make
 * `previewHost` import the Tauri adapter it must know nothing about (#200).
 */
export const SNAPSHOT_EVENT = "host://snapshot";

/** The Host's state as it travels outward. Mirrors `Snapshot` in `host-core`. */
export type Snapshot = {
  revision: number;
  playback: PlaybackSnapshot;
  /**
   * The Host's preferences: the subtitle language it prefers, and the appearance
   * it draws subtitles in. The appearance is always a value — white and 1.0 are
   * answers rather than absences — so a client never invents one (#126,
   * ADR-0024).
   */
  preferences: {
    subtitleLanguage: string | null;
    /** `#RRGGBB`, uppercase, as the Host normalized it. */
    subtitleColor: string;
    /** A finite multiplier from 0.5 to 2.0. */
    subtitleScale: number;
    /**
     * How much of a Stream the Player keeps read ahead: the look-ahead it aims
     * for, and the memory that look-ahead may take. Always a pair — a Host that
     * has never been told keeps five minutes up to half a gigabyte (#135,
     * ADR-0026).
     */
    streamBuffer: { seconds: number; megabytes: number };
  };
  addons: AddonManifest[];
  /**
   * The one Catalog the owner has marked as the Host's featured feed, where
   * there is one: what Home's hero is drawn from, its first items in the Addon's
   * own order (#74). A preference of the Host's, not this client's, so every
   * client draws the same hero — and one the Host clears when the Addon that
   * offered it is removed, so it never names an Addon that is gone.
   */
  featuredCatalog: FeaturedCatalog | null;
  protection: Protection;
  /**
   * The library: one entry per Video the Host has Watch progress in, most
   * recently played first — the Continue watching row reads it (#29). An entry
   * whose Addon is gone stays listed, marked unplayable, rather than vanishing.
   */
  watchProgress: ResumeEntry[];
  /**
   * The devices the Host has paired (#31), in the order they paired. Enough to
   * list a device and to name it when revoking; what a device holds is not here
   * and there is no field it could occupy.
   */
  devices: DeviceSummary[];
  /**
   * The code the Host is showing, which a client that has not paired redeems
   * once. It is not a credential: it is what a credential is minted from, it is
   * single-use, and the Host rotates it the moment a device redeems it.
   */
  pairingCode: string;
  /**
   * Where the Host answers remote clients, as `host:port` — a fact about the
   * machine, like where the picture is drawn, and what this window reads out so a
   * person knows where to point a browser. Null when the Host has no wire server.
   */
  address: string | null;
};

/**
 * A device the Host has paired. Mirrors `DeviceSummary` in `host-core`: the id a
 * revoke names, the name it was paired under, and when — never the token it
 * holds.
 */
export type DeviceSummary = {
  id: string;
  name: string;
  pairedAt: number;
};

/**
 * One Title in the owner's Stremio account Library, as the room draws it.
 * Mirrors `LibraryEntry` in `host-core` (#165, ADR-0029): the account's item
 * carries the name and poster, so a card needs no Addon round-trip.
 */
export type LibraryEntry = {
  id: string;
  name: string;
  type: string;
  poster: string | null;
  posterShape: string | null;
  /** When the item was last modified, in milliseconds since the Unix epoch. */
  mtime: number;
  /** The Video the account last played in this Title, where it has one. */
  videoId: string | null;
  /** How far into that Video, in seconds, past the start. */
  position: number | null;
  /** How long that Video is, in seconds, where the account knows. */
  duration: number | null;
  /** Whether the room draws the Continue mark: `timeOffset > 0`. */
  continueWatching: boolean;
};

/**
 * The answer to `Action::Library`: the account's rows in `_mtime` order, and
 * the failure that tells an empty account from one that could not be read.
 */
export type Library = {
  entries: LibraryEntry[];
  failure: ActionError | null;
};

/**
 * The Featured catalog: the one Catalog the owner has marked as the Host's
 * featured feed, by the Addon that offers it and the Catalog's own type and id.
 * Mirrors `FeaturedCatalog` in `host-core`; the Addon goes beside the Catalog
 * because a catalog id is only unique within the Addon that declared it.
 */
export type FeaturedCatalog = {
  addon: string;
  catalog: { type: string; id: string };
};

/**
 * What the Player is doing. Mirrors `PlaybackState` in `host-core`. A Stream
 * that failed is not a state of its own: nothing is playing, so the state is
 * `idle` and `failure` says why.
 */
export type PlaybackState = "idle" | "opening" | "playing" | "paused" | "ended";

/**
 * A span of the Stream in its own seconds. Mirrors `Buffered` in `host-core`:
 * where the Player's read begins and how far it has reached — not where playback
 * is, since a paused Stream reads further with every Snapshot, and a forward seek
 * can leave the end behind the position.
 */
export type Buffered = {
  start: number;
  end: number;
};

/**
 * Which season and episode the Stream playing is, as the Host read it off the
 * playing Video's id. Mirrors `Episode` in `host-core`: a position, not a
 * verdict — whether a neighbouring episode exists is what the Host refuses an
 * episode step with, not something a client decides (ADR-0021).
 */
export type Episode = {
  season: number;
  episode: number;
};

/**
 * Where the Player's picture is drawn — a fact about the machine, not a setting.
 * Mirrors `Picture` in `host-core`; a client sharing the Host's window leaves
 * the picture's rectangle unpainted where it is in the same window.
 */
export type Picture = "in_window" | "own_window" | "nowhere";

/**
 * The Stream that is playing, in the Addon's own words, without its URL: where
 * its bytes are never travels outward (a Stream URL can carry a debrid
 * session, and a Snapshot reaches every paired client). Mirrors `NowPlaying`.
 */
export type NowPlaying = {
  video: { type: string; id: string };
  addon: string;
  name: string | null;
  description: string | null;
  filename: string | null;
  bingeGroup: string | null;
};

/**
 * The two kinds of track the Host offers a control for. Video is deliberately
 * not one: the picture's own track is the Player's business, and no client asks
 * which one carries it. Mirrors `TrackKind` in `host-core`.
 */
export type TrackKind = "audio" | "subtitle";

/**
 * One track a Stream carries, as the Player lists it. Mirrors `Track` in
 * `host-core`: a word the container gave is carried verbatim, `embedded`
 * separates the tracks that came in the file from the ones added to the Stream
 * afterwards, and `selected` is which one is on right now — what the player
 * menu draws as chosen.
 */
export type Track = {
  /** The Player's own number for the track, which is what a selection names. */
  id: number;
  kind: TrackKind;
  language: string | null;
  title: string | null;
  codec: string | null;
  embedded: boolean;
  selected: boolean;
  default: boolean;
  forced: boolean;
};

/** One chapter marker, and where it starts. Mirrors `Chapter` in `host-core`. */
export type Chapter = {
  index: number;
  title: string | null;
  time: number;
};

/** How large the picture is, in pixels. Mirrors `VideoSize` in `host-core`. */
export type VideoSize = { width: number; height: number };

/** The part of the picture left after cropping, in the source's own pixels. */
export type CropRectangle = { width: number; height: number; x: number; y: number };

/**
 * What to do about the black bars around a picture. Mirrors `Crop` in
 * `host-core`: `off` keeps the whole frame, and a rectangle is measured in the
 * source's own pixels.
 */
export type Crop =
  | { kind: "off" }
  | { kind: "rectangle"; width: number; height: number; x: number; y: number };

/**
 * What shape the picture is drawn at. Mirrors `Aspect` in `host-core`: `source`
 * is the shape the Stream itself is, and a ratio stretches the picture to one.
 */
export type Aspect = { kind: "source" } | { kind: "ratio"; value: number };

/**
 * What the Player reports about how a Stream is playing, where it reports
 * anything. Mirrors `Statistics` in `host-core`.
 */
export type Statistics = {
  /** Bits per second, where a picture is being decoded at all. */
  bitrate: number | null;
  droppedFrames: number | null;
  /** `"no"` for software, a hardware API's name otherwise; verbatim. */
  hardwareDecode: string | null;
};

/**
 * What every client is told about playback: the one genuinely shared state.
 * Mirrors `PlaybackSnapshot` in `host-core`.
 *
 * It carries the whole control set as much as the transport: the tracks and
 * chapters a client can name, the speed, volume and delay in force, the crop and
 * aspect being drawn, and what the Player says about how it is going. The window
 * renders these and takes Actions from them; it decides none of them.
 */
export type PlaybackSnapshot = {
  state: PlaybackState;
  picture: Picture;
  /** Why the last Stream could not be opened, in the Player's own words. */
  failure: string | null;
  nowPlaying: NowPlaying | null;
  /**
   * Which season and episode the Stream playing is, where the Video's id says —
   * what the episode steps grey themselves from. Null for a film.
   */
  episode: Episode | null;
  /** Where playback is in seconds, and how long the Stream is, where known. */
  position: number | null;
  duration: number | null;
  /**
   * How much of the Stream the Player has read ahead, in the Stream's own
   * seconds: `end` can sit behind `position` right after a forward seek, and
   * that gap is what the reading is for. Null where the Player has no answer.
   */
  buffered: Buffered | null;
  /** The Stream's tracks — audio and subtitles — in the Player's own order. */
  tracks: Track[];
  /** The Stream's chapters, in the container's order. */
  chapters: Chapter[];
  /** Which chapter is playing, by its position in `chapters`. */
  chapter: number | null;
  speed: number | null;
  volume: number | null;
  muted: boolean | null;
  subtitleDelay: number | null;
  /** The rectangle kept after cropping, or null while uncropped. */
  crop: CropRectangle | null;
  /** The shape being drawn at, or null until something is loaded. */
  aspect: Aspect | null;
  resolution: VideoSize | null;
  statistics: Statistics | null;
};

/**
 * Where the Host's credentials are actually held, as the secret store reports
 * itself. Mirrors `SecretBackend` in `host-core`.
 */
export type SecretBackend = "keyring" | "file";

/**
 * Where the Host's credentials live, and which of them it holds — the one thing
 * about credentials that is not itself one, and is what the window says when it
 * tells a person how exposed the next one will be and whether a Stremio account
 * is signed in. Mirrors `ProtectionSnapshot` in `host-core`.
 */
export type Protection = {
  backend: SecretBackend;
  tmdbHeld: boolean;
  stremioHeld: boolean;
};

/**
 * An Addon as the Host publishes it: what it says it offers, and never where its
 * manifest lives — a manifest URL can carry the Addon's credentials.
 * Mirrors `Manifest` in `host-core`.
 */
export type AddonManifest = {
  id: string;
  name: string;
  version: string;
  resources: AddonResource[];
  types: string[];
  catalogs: AddonCatalog[];
  idPrefixes: string[];
  behaviorHints: { configurable: boolean; configurationRequired: boolean };
};

/** One resource an Addon provides. Mirrors `Resource` in `host-core`. */
export type AddonResource = {
  name: string;
  types: string[] | null;
  idPrefixes: string[] | null;
};

/** One catalog an Addon offers. Mirrors `Catalog` in `host-core`. */
export type AddonCatalog = {
  type: string;
  id: string;
  name: string;
  extra: CatalogExtra[];
};

/**
 * One control a catalog takes — `search`, `skip`, `genre` — and what it offers.
 * Mirrors `ExtraProp` in `host-core`.
 */
export type CatalogExtra = {
  name: string;
  isRequired: boolean;
  options: string[];
  optionsLimit: number;
};

/** One value a client chose about a catalog request: `skip=100`, `search=matrix`. */
export type Extra = { name: string; value: string };

/** One item in a catalog row. Mirrors `MetaPreview` in `host-core`. */
export type MetaPreview = {
  id: string;
  type: string;
  name: string;
  poster: string | null;
  posterShape: string | null;
  /**
   * The meta preview's 16:9 backdrop, where the Host sent one — an Addon's word
   * for a Catalog row, or TMDB's for a Discover or Search row. Home's hero and
   * the Title screen draw it; absent is not a failure, because a landscape
   * poster, the text, or the Title's own poster still has something to draw.
   */
  background?: string | null;
  releaseInfo: string | null;
  imdbRating: string | null;
  genres: string[];
  description: string | null;
};

/**
 * One catalog's answer, on its way to the client that asked for it. Mirrors
 * `CatalogRow` in `host-core`; `failure` says why an Addon did not answer, so one
 * Addon failing does not blank another's row, and `sent` is how many items the
 * Addon put in the page — a client pages on by that, not by what it holds.
 */
export type CatalogRow = {
  addon: string;
  type: string;
  id: string;
  name: string;
  sent: number;
  metas: MetaPreview[];
  failure: ActionError | null;
};

/**
 * One Discover page, on its way to the client that asked for it. Mirrors
 * `DiscoverRow` in `host-core`: a catalog row minus the Addon, because TMDB is
 * the source — the items are keyed `tmdb:<id>`, and `sent` is the count a
 * client pages by (#75, ADR-0020).
 */
export type DiscoverRow = {
  type: string;
  sent: number;
  metas: MetaPreview[];
  failure: ActionError | null;
};

/**
 * One Search page, on its way to the client that asked for it. Mirrors
 * `SearchRow` in `host-core`: the shape a `DiscoverRow` is, because a client
 * draws both with one card — the items are keyed `tmdb:<id>`, and `sent` is the
 * count a client pages by (#78, ADR-0010's amendment).
 */
export type SearchRow = DiscoverRow;

/**
 * One playable unit of a Title: the film itself, or a single episode. Mirrors
 * `Video` in `host-core`; `id` is the id its Addon indexes it by
 * (`tt0903747:1:1`), and it is what Watch progress is recorded against. Only the
 * fields this window draws are read — a Stream list or a thumbnail arrives with
 * the ticket that shows it.
 */
export type Video = {
  id: string;
  name: string | null;
  season: number | null;
  episode: number | null;
  /** The episode's 16:9 still, where it has one. */
  thumbnail: string | null;
  /**
   * The calendar day the episode aired, as `YYYY-MM-DD`, where the Host knows
   * one. An announced episode's day is in the future, and a Title screen marks
   * it "Airs 12 Nov" without making it unplayable (#269).
   */
  airDate: string | null;
};

/**
 * What a Title is keyed by: TMDB's own id where one of its records met the
 * Title, and the Addon that supplied it where none did — the key the window
 * reads to mark a Title unmapped. Mirrors `TitleKey` in `host-core`.
 */
export type TitleKey =
  | { kind: "tmdb"; id: number }
  | { kind: "addon"; addon: string; id: string };

/**
 * A film or series as its Addon describes it, and the Videos it can be watched
 * as. Mirrors `Title` in `host-core`; `addon` is the Addon that answered — which
 * is what a later client asks for a Video's Streams of.
 */
export type Title = {
  /** The Addon that answered, or `null` for a Discovered Title. */
  addon: string | null;
  id: string;
  key: TitleKey;
  type: string;
  name: string;
  poster: string | null;
  /** The Title's backdrop: the 16:9 art a hero is drawn from. */
  background: string | null;
  /** The Title's wordmark, drawn over the backdrop in place of the name. */
  logo: string | null;
  description: string | null;
  releaseInfo: string | null;
  runtime: string | null;
  imdbRating: string | null;
  genres: string[];
  videos: Video[];
};

/**
 * The least of a Title a library card is drawn from (#29). Mirrors `TitleStub`
 * in `host-core`: what the Host was told when a Stream was chosen, so the
 * Continue watching row can draw a card without opening anything.
 */
export type TitleStub = {
  addon: string | null;
  id: string;
  type: string;
  name: string;
  poster: string | null;
  /**
   * The Title's 16:9 backdrop, carried so a Continue watching card can be drawn
   * from the Host's record rather than from a portrait poster (#73).
   */
  background?: string | null;
};

/** Why a library entry is not one the Host will play. Mirrors `UnplayableReason`. */
export type UnplayableReason = "addon_removed";

/** Why a library entry cannot be played now. Mirrors `UnplayableEntry` in `host-core`. */
export type UnplayableEntry = {
  reason: UnplayableReason;
  /** The Addon that is no longer configured. */
  addon: string;
};

/**
 * One Video with Watch progress, as every client is told it (#29). Mirrors
 * `ResumeEntry` in `host-core`: the Video, enough of its Title to draw a card,
 * where it was left, and whether it can be played now.
 */
export type ResumeEntry = {
  video: Video;
  title: TitleStub;
  position: number | null;
  duration: number | null;
  watched: boolean;
  unplayable: UnplayableEntry | null;
};

/**
 * Where a Stream's bytes are, and whether this Host can open them. Mirrors
 * `Playback` in `host-core`: a direct URL mpv opens as itself, or an `infoHash`
 * this version lists and marks unplayable — the torrent bridge that would fetch
 * it is a later ticket.
 */
export type Playback =
  | { kind: "direct"; url: string }
  | { kind: "info_hash"; infoHash: string };

/**
 * What the Addon's hints say about playing a Stream. Mirrors `Warning` in
 * `host-core`: surfaced beside the candidate, never acted on.
 */
export type StreamWarning = "not_web_ready" | "p2p" | "proxy_headers";

/**
 * One candidate a Provider returned for a Video. Mirrors `Stream` in `host-core`:
 * `name` and `description` are the Addon's own words — its badge line and the
 * release line under it — carried through verbatim, and the Host re-ranks
 * nothing. `filename` and `bingeGroup` come from the candidate's own
 * behaviour hints.
 */
export type Stream = {
  name: string | null;
  description: string | null;
  playback: Playback;
  warnings: StreamWarning[];
  filename: string | null;
  bingeGroup: string | null;
};

/**
 * One Addon's answer to a Video's stream request. Mirrors `AddonStreams` in
 * `host-core`; `failure` says why an Addon did not answer, so one Addon being
 * down does not blank the candidates the others returned.
 */
export type AddonStreams = {
  addon: string;
  streams: Stream[];
  failure: ActionError | null;
};

/**
 * What taking an Action produced. Mirrors `Response` in `host-core`: the
 * Snapshots every client is owed, and the answer only the client that asked gets.
 * A question is answered with catalogs, Discover rows, a Search row, a Title or
 * Streams, never several.
 *
 * The one difference is `paired`: the Host's wire answer carries the Device's
 * token, and a link takes it out before the core sees it, so this mirror is the
 * answer a client may hold (ADR-0035 §1).
 */
export type Response = {
  snapshots: Snapshot[];
  answer:
    | { catalogs: CatalogRow[] }
    | { discover: DiscoverRow[] }
    | { search: SearchRow }
    | { title: Title }
    | { streams: AddonStreams[] }
    | { preview: { at: number; image: string | null } }
    // The Device token never crosses the client's door (ADR-0035 §1): a
    // WebSocket link takes it out of the answer and stores it itself, so the
    // core sees the Device and no credential.
    | { paired: { device: DeviceSummary } }
    | { library: Library }
    | null;
};

/** What a client can ask the Host to do. Mirrors `Action` in `host-core`. */
export type Action =
  | { type: "set_subtitle_language"; language: string }
  | { type: "clear_subtitle_language" }
  // The subtitle appearance (#126, ADR-0024): a preference of the Host's, so it
  // outlives a Stream and reaches every client. The colour applies where a
  // subtitle track leaves its own colour open; a size applies to every track.
  | { type: "set_subtitle_color"; color: string }
  | { type: "set_subtitle_scale"; scale: number }
  // The Stream buffer (#135, ADR-0026): the look-ahead the Player aims for and
  // the memory it may take. One Action carries the pair, so the two limits
  // cannot be half-applied.
  | { type: "set_stream_buffer"; seconds: number; megabytes: number }
  // The Featured catalog (#74): a preference of the Host's rather than this
  // client's, so marking one changes what *every* client's Home is drawn from.
  | {
      type: "set_featured_catalog";
      addon: string;
      catalog: { type: string; id: string };
    }
  | { type: "clear_featured_catalog" }
  | { type: "add_addon"; url: string }
  // The configured Addons' order is the Host's, and a client's rows follow it:
  // the move is a position in that list, 0-based, judged by the Host (#74).
  | { type: "reorder_addon"; id: string; position: number }
  | { type: "remove_addon"; id: string }
  | { type: "set_tmdb_key"; key: string }
  | { type: "clear_tmdb_key" }
  // The Stremio account link (#30): optional, and off until an account is signed
  // in. The Host exchanges the password once for an `authKey` it keeps in the
  // secret store — the password is sent and never held, and no part of either
  // credential travels back in a Snapshot.
  | { type: "sign_in_stremio"; email: string; password: string }
  | { type: "sign_out_stremio" }
  | {
      type: "browse_catalog";
      addon: string;
      catalog: { type: string; id: string };
      extra: Extra[];
    }
  | { type: "search_catalogs"; query: string }
  // TMDB's page of Discovered Titles (#75, ADR-0020): with neither filter it is
  // the week's trending feed, and a genre or a sort order makes it a /discover
  // page judged in the kind's own terms. The Host holds the credential and
  // builds the URL; this window never does.
  | {
      type: "discover";
      kind: string;
      page: number;
      genre?: number | null;
      sort?: string | null;
    }
  // TMDB's answer to a query, one kind and one page at a time (#78, ADR-0010's
  // amendment). A key held makes Search TMDB's; with none the window sends
  // `search_catalogs` instead and the Addons' own catalogs answer.
  | { type: "search"; query: string; kind: string; page: number }
  | {
      type: "open_title";
      addon: string;
      title: { type: string; id: string };
    }
  // A Discovered Title: one TMDB named before any Addon did, opened against
  // TMDB itself rather than through an Addon (ADR-0020). The key says TMDB's
  // record; `kind` is the protocol's spelling of what it is (`movie`/`series`).
  | { type: "open_discovered_title"; key: TitleKey; kind: string }
  | { type: "find_streams"; video: { type: string; id: string } }
  // A still of one moment of the Stream playing, for the timeline's tooltip
  // (#140, ADR-0028). A Question: it publishes nothing, moves no state, and a
  // moment the Host cannot draw comes back as an answer with no image rather
  // than as a failure.
  | { type: "preview"; at: number }
  // The owner's Stremio account Library, read for the room (#165, ADR-0029).
  // A question: it publishes no Snapshot and puts no library item in one.
  | { type: "library" }
  | {
      type: "play_stream";
      video: { type: string; id: string };
      addon: string;
      stream: Stream;
      // The Title the Video belongs to, as the client was reading it: enough for
      // the Host to record Watch progress against a card (#29).
      title: TitleStub;
    }
  | { type: "resume"; video: { type: string; id: string } }
  | { type: "set_paused"; paused: boolean }
  | { type: "seek"; target: SeekTarget }
  | { type: "stop_playback" }
  | { type: "set_audio_track"; track: number }
  | { type: "set_subtitle_track"; track: number | null }
  | { type: "set_subtitle_delay"; seconds: number }
  | { type: "set_speed"; rate: number }
  | { type: "set_volume"; level: number }
  | { type: "set_muted"; muted: boolean }
  | { type: "next_chapter" }
  | { type: "previous_chapter" }
  | { type: "set_chapter"; index: number }
  | { type: "set_crop"; crop: Crop }
  // The Player's own script crops to the bars it finds, or puts the full frame
  // back: the rectangle is its answer, so the Host records it on the next report
  // rather than at the press (#119).
  | { type: "autocrop" }
  | { type: "set_aspect"; aspect: Aspect }
  // The Action the window sends for a series' next episode: the Host decides
  // which Video that is — asking its Addons, not counting up an id — and answers
  // whether it can move to one at all.
  | { type: "next_episode" }
  // The same step back, decided by the Host the same way (ADR-0021).
  | { type: "previous_episode" }
  // Pairing and devices (#31). `pair_device` is the one Action an unpaired
  // connection may take; this window is the Host's own and is already in, so what
  // it sends is the revoke: one device's token is taken away and every other
  // device keeps working.
  | { type: "pair_device"; code: string; name: string }
  | { type: "revoke_device"; id: string };

/**
 * Where a seek goes: to a second of the Stream, or by some seconds from where
 * playback is. Mirrors `SeekTarget` in `host-core`.
 */
export type SeekTarget =
  | { kind: "to"; seconds: number }
  | { kind: "by"; seconds: number };

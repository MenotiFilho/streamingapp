import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

/**
 * The version of the Action wire form this client speaks.
 * Mirrors `ACTION_VERSION` in `host-core`.
 */
export const ACTION_VERSION = 1;

/** The event the Host publishes Snapshots on. Mirrors `SNAPSHOT_EVENT` in `src-tauri/src/ipc.rs`. */
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
 */
export type Response = {
  snapshots: Snapshot[];
  answer:
    | { catalogs: CatalogRow[] }
    | { discover: DiscoverRow[] }
    | { search: SearchRow }
    | { title: Title }
    | { streams: AddonStreams[] }
    | { paired: { device: DeviceSummary; token: string } }
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

/**
 * The failures the Host itself reports. Mirrors the variants of `ActionError` in
 * `host-core`; the union below is derived from this list so the two cannot drift.
 */
export const HOST_ERROR_KINDS = [
  "malformed",
  "unsupported_version",
  "invalid_subtitle_language",
  "invalid_subtitle_color",
  "invalid_subtitle_scale",
  "invalid_manifest_url",
  "invalid_addon_id",
  "invalid_tmdb_key",
  "invalid_catalog_ref",
  "invalid_title_ref",
  "invalid_video_ref",
  "invalid_seek_target",
  "invalid_speed",
  "invalid_volume",
  "invalid_subtitle_delay",
  "invalid_aspect",
  "invalid_crop",
  "manifest",
  "fetch",
  "unknown_addon",
  "unknown_catalog",
  "unknown_title",
  "not_discovered_title",
  "tmdb",
  "unknown_track",
  "unknown_chapter",
  "invalid_position",
  "extra",
  "query",
  "catalog",
  "meta",
  "stream",
  "subtitles",
  "unplayable",
  "nothing_playing",
  "no_next_episode",
  "no_previous_episode",
  "no_progress",
  "playback",
  "store",
  "secret",
  "invalid_stremio_login",
  "sync_unavailable",
  "sync",
  "invalid_pairing_code",
  "invalid_device_id",
  "invalid_device_name",
  "pairing",
  "unknown_device",
  "unpaired",
  "already_paired",
  "invalid_discover",
  "invalid_search",
  "no_tmdb_credential",
] as const;

/**
 * The control a refusal names, in the Host's own tags. Mirrors `Control` in
 * `host-core`; every control that can be refused is here, and a client reads it
 * to say which one was refused.
 */
export type Control =
  | "pause"
  | "seek"
  | "stop"
  | "audio_track"
  | "subtitle_track"
  | "subtitle_delay"
  | "speed"
  | "volume"
  | "mute"
  | "chapter"
  | "crop"
  | "aspect"
  | "next_episode"
  | "previous_episode";

/**
 * Why an Action was not taken, in the Host's own vocabulary, plus `unreachable`
 * for the failures that happen before the Host ever hears about it.
 */
export type ActionError = {
  kind: (typeof HOST_ERROR_KINDS)[number] | "unreachable";
  detail?: string;
  got?: number;
  supported?: number;
  language?: string;
  /** The colour a refusal echoes: a refused subtitle colour. */
  color?: string;
  /** The size a refusal echoes: a refused subtitle scale. */
  scale?: string;
  url?: string;
  /** An Addon's id, or a track's number: two refusals name an `id`. */
  id?: string | number;
  addon?: string;
  which?: string;
  value?: string;
  catalog?: { type: string; id: string };
  title?: { type: string; id: string };
  video?: { type: string; id: string };
  /** The value a refusal carries: the seconds a seek or a delay could not use. */
  seconds?: string;
  /** The value a refused speed or volume carries. */
  rate?: string;
  level?: string;
  /** The rectangle a refused crop would keep. */
  crop?: string;
  /** The position a refused chapter names. */
  index?: number;
  /** The position a refused reorder asked for. */
  position?: number;
  /** How many Addons the Host was configured with when it refused the reorder. */
  count?: number;
  /** The control a refusal is about, where the refusal is about one. */
  control?: Control;
  /** The pairing code a refusal names, where the refusal is about one. */
  code?: string;
  /** The device name a refusal names, where the refusal is about one. */
  name?: string;
};

/**
 * The catalog rows an answer carries, when the Action was a browse or a search.
 * An empty list when it was something else, so a caller cannot read a Title's
 * answer as a row that is not there.
 */
export function answeredCatalogs(response: Response | null): CatalogRow[] {
  const answer = response?.answer;
  return answer && "catalogs" in answer ? answer.catalogs : [];
}

/** The Discover rows an answer carries, when the Action was a `discover` (#75). */
export function answeredDiscover(response: Response | null): DiscoverRow[] {
  const answer = response?.answer;
  return answer && "discover" in answer ? answer.discover : [];
}

/**
 * The Search row an answer carries, when the Action was a `search` (#78): one
 * kind's page, or null when the Action was something else.
 */
export function answeredSearch(response: Response | null): SearchRow | null {
  const answer = response?.answer;
  return answer && "search" in answer ? answer.search : null;
}

/** The Title an answer carries, when the Action was an `open_title`. */
export function answeredTitle(response: Response | null): Title | null {
  const answer = response?.answer;
  return answer && "title" in answer ? answer.title : null;
}

/**
 * The Stream groups an answer carries, when the Action was a `find_streams`:
 * one per Addon that answered, in the configured order.
 */
export function answeredStreams(response: Response | null): AddonStreams[] {
  const answer = response?.answer;
  return answer && "streams" in answer ? answer.streams : [];
}

/** Whatever a failed call threw, as something the window can explain. */
export function asActionError(caught: unknown): ActionError {
  if (typeof caught === "object" && caught !== null) {
    const kind = (caught as { kind?: unknown }).kind;
    if (
      typeof kind === "string" &&
      (HOST_ERROR_KINDS as readonly string[]).includes(kind)
    ) {
      return caught as ActionError;
    }
  }
  return { kind: "unreachable", detail: String(caught) };
}

/** A person-readable account of a rejected Action. */
export function explain(error: ActionError): string {
  switch (error.kind) {
    case "malformed":
      return `The Host could not read that Action${error.detail ? `: ${error.detail}` : ""}.`;
    case "unsupported_version":
      return `This window speaks version ${ACTION_VERSION} and the Host ${error.supported}; the Action carried version ${error.got}.`;
    case "invalid_subtitle_language":
      return `${JSON.stringify(error.language)} is not a subtitle language tag — try "pt-BR" or "en".`;
    case "invalid_subtitle_color":
      return `${JSON.stringify(error.color)} is not a subtitle colour — a colour is "#RRGGBB", like "#FFFF00".`;
    case "invalid_subtitle_scale":
      return `${JSON.stringify(error.scale)} is not a subtitle size — a size is between 0.5 and 2.0.`;
    case "invalid_manifest_url":
      return `${JSON.stringify(error.url)} is not a manifest URL — paste the address of an Addon's manifest.json, like "https://example.com/manifest.json".`;
    case "invalid_addon_id":
      return `${JSON.stringify(error.id)} is not an Addon id.`;
    case "invalid_tmdb_key":
      // The Host carries no part of a refused key back — a refused key can
      // still be a credential with a typo in it — so there is no value here to
      // echo or not.
      return `The Host will not keep that TMDB key${error.detail ? `: ${error.detail}` : ""}.`;
    case "invalid_catalog_ref":
      return `${JSON.stringify(error.value)} is not a catalog ${error.which}.`;
    case "invalid_title_ref":
      return `${JSON.stringify(error.value)} is not a Title ${error.which}.`;
    case "invalid_video_ref":
      return `${JSON.stringify(error.value)} is not a Video ${error.which}.`;
    case "invalid_seek_target":
      return `${JSON.stringify(error.seconds)} is not a number of seconds to seek by.`;
    case "invalid_speed":
      return `${JSON.stringify(error.rate)} is not a playback speed — a speed is a number from 0.05 to 100.`;
    case "invalid_volume":
      return `${JSON.stringify(error.level)} is not a volume — a volume is a number from 0 to 130.`;
    case "invalid_subtitle_delay":
      return `${JSON.stringify(error.seconds)} is not a subtitle delay — a delay is at most an hour either way.`;
    case "invalid_aspect":
      return `${JSON.stringify(error.value)} is not a picture shape — an aspect ratio is greater than 0 and at most 100.`;
    case "invalid_crop":
      return `${JSON.stringify(error.crop)} is not a crop — a crop needs a width and a height, both greater than zero.`;
    case "manifest":
      return `The Host could not read that Addon's manifest${error.detail ? `: ${error.detail}` : ""}.`;
    case "fetch":
      return `The Host could not fetch that Addon${error.detail ? `: ${error.detail}` : ""}.`;
    case "unknown_addon":
      return `No Addon with the id ${JSON.stringify(error.id)} is configured.`;
    case "unknown_catalog":
      return `The Addon ${JSON.stringify(error.addon)} offers no catalog ${error.catalog?.type ?? "?"}/${error.catalog?.id ?? "?"}.`;
    case "unknown_title":
      return `The Addon ${JSON.stringify(error.addon)} offers no meta for ${error.title?.type ?? "?"}/${error.title?.id ?? "?"}.`;
    case "not_discovered_title":
      return `That is not a Discovered Title${error.detail ? `: ${error.detail}` : ""}.`;
    case "tmdb":
      return `TMDB did not answer${error.detail ? `: ${error.detail}` : ""}.`;
    case "unknown_track":
      // The `control` a Host sends for a track is its own tag (`audio_track`),
      // so it is put back into the words a person reads rather than shown raw.
      return `The Stream carries no ${error.control === "subtitle_track" ? "subtitle" : "audio"} track numbered ${error.id}.`;
    case "unknown_chapter":
      return `The Stream has no chapter at position ${error.index}.`;
    case "invalid_position":
      return `The Host has no Addon position ${error.position} — it is configured with ${error.count}.`;
    case "extra":
      return error.detail ?? "The Host will not ask for that catalog with those values.";
    case "query":
      return error.detail ?? "The Host will not search for that.";
    case "invalid_discover":
      return error.detail ?? "The Host will not discover that.";
    case "invalid_search":
      return error.detail ?? "The Host will not search TMDB for that.";
    case "no_tmdb_credential":
      return "This Host holds no TMDB key, so it cannot ask TMDB.";
    case "catalog":
      return `The Host could not read that Addon's catalog${error.detail ? `: ${error.detail}` : ""}.`;
    case "meta":
      return `The Host could not read that Addon's meta response${error.detail ? `: ${error.detail}` : ""}.`;
    case "stream":
      return `The Host could not read that Addon's stream response${error.detail ? `: ${error.detail}` : ""}.`;
    case "subtitles":
      return `The Host could not read that Addon's subtitles response${error.detail ? `: ${error.detail}` : ""}.`;
    case "unplayable":
      return `The Host will not play that Stream: ${error.detail ?? "it is not one it can open"}`;
    case "nothing_playing":
      return `Nothing is playing, so the Host cannot ${controlWords(error.control)}.`;
    case "no_next_episode":
      return `The Host could not move to the next episode${error.detail ? `: ${error.detail}` : ""}.`;
    case "no_previous_episode":
      return `The Host could not move to the previous episode${error.detail ? `: ${error.detail}` : ""}.`;
    case "no_progress":
      return `The Host has no Watch progress for ${error.video?.type ?? "?"}/${error.video?.id ?? "?"}, so there is nothing to resume.`;
    case "playback":
      return `The Host's player could not do that${error.detail ? `: ${error.detail}` : ""}.`;
    case "store":
      return `The Host could not save that change${error.detail ? `: ${error.detail}` : ""}.`;
    case "secret":
      return `The Host could not keep that credential${error.detail ? `: ${error.detail}` : ""}.`;
    case "invalid_stremio_login":
      // As with a refused key, the Host carries back the reason and no part of
      // the sign-in: a typo'd password is still a password.
      return `The Host will not send that Stremio sign-in${error.detail ? `: ${error.detail}` : ""}.`;
    case "sync_unavailable":
      return "This Host was built without Stremio account sync, so it cannot sign in.";
    case "sync":
      return `The Host could not sign in to Stremio${error.detail ? `: ${error.detail}` : ""}.`;
    case "invalid_pairing_code":
      return `${JSON.stringify(error.code)} is not a pairing code — a code is six letters and digits, like "4K7Q2M".`;
    case "invalid_device_id":
      return `${JSON.stringify(error.id)} is not a device id.`;
    case "invalid_device_name":
      return `A device needs a name of a few words, not ${JSON.stringify(error.name)}.`;
    case "pairing":
      // The Host carries no part of a refused code back: a mistyped code may
      // still be a code, and there is nothing useful to echo.
      return "That is not the pairing code the Host is showing.";
    case "unknown_device":
      return `No device with the id ${JSON.stringify(error.id)} is paired with this Host.`;
    case "unpaired":
      return "This connection has not paired, so the Host will only take a pairing.";
    case "already_paired":
      return "This connection has already paired; a device pairs by being unpaired.";
    case "unreachable":
      return `The window could not reach the Host${error.detail ? `: ${error.detail}` : ""}.`;
  }
}

/**
 * The control a `nothing_playing` refusal names, as the words a sentence uses.
 * The Host sends its own tag (`audio_track`); this is the other half of that
 * vocabulary, so a refusal reads as a sentence rather than as a tag.
 */
function controlWords(control: Control | undefined): string {
  switch (control) {
    case "pause":
      return "pause";
    case "seek":
      return "seek";
    case "stop":
      return "stop";
    case "audio_track":
      return "change the audio track";
    case "subtitle_track":
      return "change the subtitle track";
    case "subtitle_delay":
      return "shift the subtitles";
    case "speed":
      return "change the speed";
    case "volume":
      return "change the volume";
    case "mute":
      return "change the mute";
    case "chapter":
      return "move between chapters";
    case "crop":
      return "crop the picture";
    case "aspect":
      return "change the aspect";
    case "next_episode":
      return "play the next episode";
    case "previous_episode":
      return "play the previous episode";
    default:
      return "do that";
  }
}

/**
 * How the window reaches the Host. The Tauri transport is the real one; a test
 * hands in its own so the window can be driven without a Host.
 */
export type Transport = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<() => void>;
};

export const tauriTransport: Transport = {
  invoke: (command, args) => tauriInvoke(command, args),
  listen: (event, handler) => tauriListen(event, handler),
};

/**
 * The Host, as the window sees it.
 *
 * The window never decides what state is: it takes Actions and renders whatever
 * the Host publishes, which is the same door a remote client uses (ADR-0002).
 */
export class HostClient {
  constructor(private readonly transport: Transport = tauriTransport) {}

  /** The state as it stands — what a window that has just loaded is owed. */
  snapshot(): Promise<Snapshot> {
    return this.transport.invoke<Snapshot>("snapshot");
  }

  /** Take an Action through the one door, and get back what came of it. */
  async dispatch(action: Action): Promise<Response> {
    return this.transport.invoke<Response>("dispatch", {
      envelope: { version: ACTION_VERSION, action },
    });
  }

  /** Follow the Snapshots the Host publishes. */
  onSnapshot(handler: (snapshot: Snapshot) => void): Promise<() => void> {
    return this.transport.listen<Snapshot>(SNAPSHOT_EVENT, (event) =>
      handler(event.payload),
    );
  }
}

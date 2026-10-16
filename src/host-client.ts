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
  preferences: { subtitleLanguage: string | null };
  addons: AddonManifest[];
  protection: Protection;
};

/**
 * What the Player is doing. Mirrors `PlaybackState` in `host-core`. A Stream
 * that failed is not a state of its own: nothing is playing, so the state is
 * `idle` and `failure` says why.
 */
export type PlaybackState = "idle" | "opening" | "playing" | "paused" | "ended";

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
 * What every client is told about playback: the one genuinely shared state.
 * Mirrors `PlaybackSnapshot` in `host-core`.
 */
export type PlaybackSnapshot = {
  state: PlaybackState;
  picture: Picture;
  /** Why the last Stream could not be opened, in the Player's own words. */
  failure: string | null;
  nowPlaying: NowPlaying | null;
  /** Where playback is in seconds, and how long the Stream is, where known. */
  position: number | null;
  duration: number | null;
};

/**
 * Where the Host's credentials are actually held, as the secret store reports
 * itself. Mirrors `SecretBackend` in `host-core`.
 */
export type SecretBackend = "keyring" | "file";

/**
 * Where the Host's credentials live, and whether it holds a TMDB key — the one
 * thing about credentials that is not itself one, and is what the window says
 * when it tells a person how exposed the next one will be. Mirrors
 * `ProtectionSnapshot` in `host-core`.
 */
export type Protection = {
  backend: SecretBackend;
  tmdbHeld: boolean;
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
  addon: string;
  id: string;
  key: TitleKey;
  type: string;
  name: string;
  poster: string | null;
  description: string | null;
  releaseInfo: string | null;
  runtime: string | null;
  imdbRating: string | null;
  genres: string[];
  videos: Video[];
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
 * A question is answered with catalogs, a Title or Streams, never several.
 */
export type Response = {
  snapshots: Snapshot[];
  answer: { catalogs: CatalogRow[] } | { title: Title } | { streams: AddonStreams[] } | null;
};

/** What a client can ask the Host to do. Mirrors `Action` in `host-core`. */
export type Action =
  | { type: "set_subtitle_language"; language: string }
  | { type: "clear_subtitle_language" }
  | { type: "add_addon"; url: string }
  | { type: "remove_addon"; id: string }
  | { type: "set_tmdb_key"; key: string }
  | { type: "clear_tmdb_key" }
  | {
      type: "browse_catalog";
      addon: string;
      catalog: { type: string; id: string };
      extra: Extra[];
    }
  | { type: "search_catalogs"; query: string }
  | {
      type: "open_title";
      addon: string;
      title: { type: string; id: string };
    }
  | { type: "find_streams"; video: { type: string; id: string } }
  | {
      type: "play_stream";
      video: { type: string; id: string };
      addon: string;
      stream: Stream;
    }
  | { type: "set_paused"; paused: boolean }
  | { type: "seek"; target: SeekTarget }
  | { type: "stop_playback" };

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
  "invalid_manifest_url",
  "invalid_addon_id",
  "invalid_tmdb_key",
  "invalid_catalog_ref",
  "invalid_title_ref",
  "invalid_video_ref",
  "invalid_seek_target",
  "manifest",
  "fetch",
  "unknown_addon",
  "unknown_catalog",
  "unknown_title",
  "extra",
  "query",
  "catalog",
  "meta",
  "stream",
  "unplayable",
  "nothing_playing",
  "playback",
  "store",
  "secret",
] as const;

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
  url?: string;
  id?: string;
  addon?: string;
  which?: string;
  value?: string;
  catalog?: { type: string; id: string };
  title?: { type: string; id: string };
  video?: { type: string; id: string };
  /** The value a refusal carries: seconds a seek could not use, an Action a control could not be taken for. */
  seconds?: string;
  what?: string;
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

/** The Title an answer carries, when the Action was an `open_title`. */
export function answeredTitle(response: Response | null): Title | null {
  const answer = response?.answer;
  return answer && "title" in answer ? answer.title : null;
}

/**
 * The Stream groups an answer carries, when the Action was a `find_streams`:
 * one per Addon that answered, in the order the Addons were configured.
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
    case "extra":
      return error.detail ?? "The Host will not ask for that catalog with those values.";
    case "query":
      return error.detail ?? "The Host will not search for that.";
    case "catalog":
      return `The Host could not read that Addon's catalog${error.detail ? `: ${error.detail}` : ""}.`;
    case "meta":
      return `The Host could not read that Addon's meta response${error.detail ? `: ${error.detail}` : ""}.`;
    case "stream":
      return `The Host could not read that Addon's stream response${error.detail ? `: ${error.detail}` : ""}.`;
    case "unplayable":
      return `The Host will not play that Stream: ${error.detail ?? "it is not one it can open"}`;
    case "nothing_playing":
      return `Nothing is playing, so the Host cannot ${error.what ?? "do that"}.`;
    case "playback":
      return `The Host's player could not do that${error.detail ? `: ${error.detail}` : ""}.`;
    case "store":
      return `The Host could not save that change${error.detail ? `: ${error.detail}` : ""}.`;
    case "secret":
      return `The Host could not keep that credential${error.detail ? `: ${error.detail}` : ""}.`;
    case "unreachable":
      return `The window could not reach the Host${error.detail ? `: ${error.detail}` : ""}.`;
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

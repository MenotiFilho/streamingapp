import type { ActionError } from "./errors";
import type {
  AddonStreams,
  CatalogRow,
  DeviceSummary,
  DiscoverRow,
  Library,
  Response,
  SearchRow,
  Title,
} from "./wire";

/**
 * The answer a client may hold: the same Response with the Device token taken
 * out, where a transport still delivered one.
 *
 * A token is the WebSocket link's to keep, not the core's to carry (ADR-0035
 * §1). The type already says `paired` is a Device and no token; this is the
 * runtime half of that promise for a transport that has not caught up. A
 * response with nothing to drop is returned untouched.
 */
export function withoutToken(response: Response): Response {
  const answer = response.answer;
  if (!answer || !("paired" in answer)) {
    return response;
  }
  const paired = answer.paired as { device: DeviceSummary; token?: string };
  if (!("token" in paired)) {
    return response;
  }
  return { ...response, answer: { ...answer, paired: { device: paired.device } } };
}

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

/**
 * The still an answer carries, when the Action was a `preview` (#140): the
 * moment the Host answered about — echoed so a client that coalesces its asks
 * knows which one this is — and the image, where there is one.
 */
export function answeredPreview(
  response: Response | null,
): { at: number; image: string | null } | null {
  const answer = response?.answer;
  return answer && "preview" in answer ? answer.preview : null;
}

/** The account Library an answer carries, when the Action was `library`. */
export function answeredLibrary(response: Response | null): Library | null {
  const answer = response?.answer;
  return answer && "library" in answer ? answer.library : null;
}

/**
 * What taking an Action came to: the answer, or why the Host refused it.
 *
 * It lives here, with the answers, because it is the shape both a window screen
 * and a remote screen read back from the one door.
 */
export type ActionOutcome = {
  response: Response | null;
  error: ActionError | null;
};

import type { Snapshot, Title, Video } from "../../host-client";
import { isSeries, labelOf, nameOf, type OpenablePreview } from "../../title";
import { addonName } from "../home";

/**
 * The Streams list's own decisions, kept out of the drawing (ADR-0032).
 *
 * The level's name, the Addon a group is headed by, and the count its kicker
 * prints are rules: a series' Streams are its episode's, a film's are the
 * Title's, and an Addon without a display name is still a group.
 */

/**
 * What the Streams are Streams *of*: a series' episode by the number and name
 * its Addon listed, or the Title a film is. The title's own name is the page's,
 * not this level's prefix — the surface says "Streams" around it.
 */
export function streamsSubject(
  title: Title,
  preview: OpenablePreview | null | undefined,
  video: Video,
): string {
  if (!isSeries(title)) {
    return nameOf(title, preview);
  }

  const episode = labelOf(video);
  if (!episode) {
    return video.name ?? video.id;
  }
  return video.name ? `${episode} — ${video.name}` : episode;
}

/** The Addon a group is headed by: the Host's display name, or the id when it has none. */
export function streamsGroupName(snapshot: Snapshot | null, addon: string): string {
  return addonName(snapshot, addon) ?? addon;
}

/** The list's bookkeeping: `12 candidates / 3 Addons`, singular where there is one. */
export function candidateCountLabel(count: number, addons: number): string {
  const candidates = count === 1 ? "candidate" : "candidates";
  const group = addons === 1 ? "Addon" : "Addons";
  return `${count} ${candidates} / ${addons} ${group}`;
}

/**
 * The rehearsal settings of the repertory prototype.
 *
 * The first slice has two frames, two type pairings and two feature models. They
 * are a comparison, not product state: nothing here is a Host preference, and a
 * reload must land on the same frame the owner was looking at. The query string
 * is therefore the whole store — a screenshot URL is a reproducible setting.
 *
 * These are prototype decisions and leave with the flag.
 */

export type FrameVariant = "spine" | "strip";
export type TypePairing = "bodoni" | "playfair";
export type FeatureMode = "still" | "rotates";

export type RepertorySettings = {
  frame: FrameVariant;
  pairing: TypePairing;
  feature: FeatureMode;
  /** Whether the rehearsal bar is drawn. Off for a clean screenshot. */
  rehearsal: boolean;
};

export const DEFAULT_SETTINGS: RepertorySettings = {
  frame: "spine",
  pairing: "bodoni",
  feature: "rotates",
  rehearsal: true,
};

export const FRAME_OPTIONS: readonly { id: FrameVariant; label: string }[] = [
  { id: "spine", label: "Spine" },
  { id: "strip", label: "Program strip" },
];

export const PAIRING_OPTIONS: readonly { id: TypePairing; label: string; note: string }[] = [
  { id: "bodoni", label: "Bodoni", note: "Bodoni Moda · Inter · IBM Plex Mono" },
  { id: "playfair", label: "Playfair", note: "Playfair Display · IBM Plex Sans · IBM Plex Mono" },
];

export const FEATURE_OPTIONS: readonly { id: FeatureMode; label: string }[] = [
  { id: "still", label: "Still" },
  { id: "rotates", label: "Rotates" },
];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function boolParam(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }
  if (value === "0" || value === "false" || value === "off" || value === "no") {
    return false;
  }
  if (value === "1" || value === "true" || value === "on" || value === "yes") {
    return true;
  }
  return fallback;
}

/** Read the prototype settings from a query string; anything unknown falls back. */
export function parseSettings(search: string): RepertorySettings {
  const params = new URLSearchParams(search);
  return {
    frame: oneOf(
      params.get("frame"),
      FRAME_OPTIONS.map((option) => option.id),
      DEFAULT_SETTINGS.frame,
    ),
    pairing: oneOf(
      params.get("type"),
      PAIRING_OPTIONS.map((option) => option.id),
      DEFAULT_SETTINGS.pairing,
    ),
    feature: oneOf(
      params.get("feature"),
      FEATURE_OPTIONS.map((option) => option.id),
      DEFAULT_SETTINGS.feature,
    ),
    rehearsal: boolParam(params.get("rehearsal"), DEFAULT_SETTINGS.rehearsal),
  };
}

/** The query string for one set of settings, in a stable order. */
export function settingsQuery(settings: RepertorySettings): string {
  const params = new URLSearchParams();
  params.set("frame", settings.frame);
  params.set("type", settings.pairing);
  params.set("feature", settings.feature);
  if (!settings.rehearsal) {
    params.set("rehearsal", "0");
  }
  return params.toString();
}

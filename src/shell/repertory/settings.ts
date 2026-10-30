/**
 * The rehearsal settings of the repertory prototype.
 *
 * The first slice compared two feature models. That is a comparison, not
 * product state: nothing here is a Host preference, and a reload must land on
 * the same model the owner was looking at. The query string is therefore the
 * whole store — a screenshot URL is a reproducible setting. There is one frame
 * (the spine) and one type pairing (Bodoni Moda / Inter / IBM Plex Mono), so
 * neither is a setting.
 *
 * These are prototype decisions and leave with the flag.
 */

export type FeatureMode = "still" | "rotates";

export type RepertorySettings = {
  feature: FeatureMode;
  /** Whether the rehearsal bar is drawn. Off for a clean screenshot. */
  rehearsal: boolean;
};

export const DEFAULT_SETTINGS: RepertorySettings = {
  feature: "rotates",
  rehearsal: true,
};

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
  params.set("feature", settings.feature);
  if (!settings.rehearsal) {
    params.set("rehearsal", "0");
  }
  return params.toString();
}

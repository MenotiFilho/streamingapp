/** The most genres the meta line prints (`docs/design-system.md` §8). */
export const META_GENRE_LIMIT = 3;

export type MetaInput = {
  /** The IMDb rating, only where the Host carries one. */
  rating?: string | null;
  /** The Addon's own release line, such as `2024` or `2023–`. */
  year?: string | null;
  runtime?: string | null;
  genres?: readonly string[];
};

export type MetaFact = { key: "year" | "runtime" | "genres"; text: string };

export type MetaFacts = {
  rating: string | null;
  /** What follows the rating, in order, with nothing empty. */
  facts: MetaFact[];
};

/** What the meta line says: the Host's facts verbatim, and no placeholder. */
export function metaFacts({ rating, year, runtime, genres }: MetaInput): MetaFacts {
  const named = (genres ?? [])
    .map((genre) => genre.trim())
    .filter(Boolean)
    .slice(0, META_GENRE_LIMIT)
    .join(", ");
  const candidates: Array<[MetaFact["key"], string | null | undefined]> = [
    ["year", year],
    ["runtime", runtime],
    ["genres", named],
  ];

  return {
    rating: rating?.trim() || null,
    facts: candidates.flatMap(([key, value]) => {
      const text = value?.trim();
      return text ? [{ key, text }] : [];
    }),
  };
}

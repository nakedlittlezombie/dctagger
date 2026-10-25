import type { DiscogsRelease } from "./types";

const MAX_GENRES = 8;

/** Trim, drop empties, and de-duplicate genres case-insensitively. */
export function normalizeGenres(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values ?? []) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= MAX_GENRES) break;
  }
  return result;
}

/**
 * The genre value written to tags and shown in the metadata preview:
 * Discogs genres + styles first, then each fallback in order (Deezer,
 * MusicBrainz), then the album's existing local genres.
 */
export function releaseGenres(
  release: Pick<DiscogsRelease, "genres" | "styles">,
  localGenres?: readonly string[],
  ...fallbackGenres: Array<readonly string[] | undefined>
): string[] {
  const combined = normalizeGenres([...(release.genres ?? []), ...(release.styles ?? [])]);
  if (combined.length > 0) return combined;
  for (const fallback of fallbackGenres) {
    const normalized = normalizeGenres(fallback);
    if (normalized.length > 0) return normalized;
  }
  return normalizeGenres(localGenres);
}

/**
 * Discogs appends a numeric disambiguation like "(2)" or "(39)" to artists
 * that share a name. It is catalogue metadata, not part of the artist name.
 * Remove those suffixes wherever an artist name is written or displayed.
 */
export function cleanArtistName(name: string | undefined): string {
  if (!name) return "";
  const cleaned = name
    .replace(/\s*\(\s*\d+\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Unknown Artist";
  return cleaned.toLowerCase() === "various" ? "Various Artists" : cleaned;
}

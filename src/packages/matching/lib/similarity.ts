const EDITION_NOISE =
  /[\(\[]\s*(?:\d{4}\s+)?(?:deluxe|expanded|remaster(?:ed)?|anniversary|special|limited|collector'?s?|bonus|reissue)[^\)\]]*[\)\]]/gi;
const FEATURE_NOISE = /\s*[\(\[]\s*(?:feat\.?|featuring|ft\.?)\s+[^\)\]]+[\)\]]/gi;

export function normalizeText(input: string | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAlbum(input: string | undefined): string {
  if (!input) return "";
  return normalizeText(input.replace(EDITION_NOISE, " "));
}

export function normalizeTrackTitle(input: string | undefined): string {
  if (!input) return "";
  return normalizeText(input.replace(FEATURE_NOISE, " ").replace(EDITION_NOISE, " "));
}

function withoutLeadingThe(value: string): string {
  return value.replace(/^the /, "");
}

function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length === 0) return 1;
  if (shorter.length === 0) return 0;

  const previous = new Array<number>(shorter.length + 1);
  const current = new Array<number>(shorter.length + 1);
  for (let j = 0; j <= shorter.length; j += 1) previous[j] = j;

  for (let i = 1; i <= longer.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= shorter.length; j += 1) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= shorter.length; j += 1) previous[j] = current[j] ?? 0;
  }

  return 1 - (previous[shorter.length] ?? longer.length) / longer.length;
}

function tokenSimilarity(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

/**
 * Combined string similarity in [0, 1]: edit distance plus token overlap.
 * Contained strings get a floor so "Blue Monday" vs "Blue Monday (12\" Mix)"
 * still scores well.
 */
export function similarity(a: string | undefined, b: string | undefined): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const direct = 0.6 * editSimilarity(left, right) + 0.4 * tokenSimilarity(left, right);
  const shortest = left.length <= right.length ? left : right;
  const longest = left.length <= right.length ? right : left;
  const contained =
    shortest.length >= 4 && longest.includes(shortest)
      ? 0.72 + 0.28 * (shortest.length / longest.length)
      : 0;

  return Math.min(1, Math.max(direct, contained));
}

export function albumSimilarity(a: string | undefined, b: string | undefined): number {
  return similarity(normalizeAlbum(a), normalizeAlbum(b));
}

export function trackSimilarity(a: string | undefined, b: string | undefined): number {
  return similarity(normalizeTrackTitle(a), normalizeTrackTitle(b));
}

export function artistSimilarity(a: string | undefined, b: string | undefined): number {
  const left = withoutLeadingThe(normalizeText(a));
  const right = withoutLeadingThe(normalizeText(b));
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return 0.82 + 0.18 * (Math.min(left.length, right.length) / Math.max(left.length, right.length));
  }
  return similarity(left, right);
}

export function bestSimilarity(
  value: string | undefined,
  candidates: Array<string | undefined>,
): number {
  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, similarity(value, candidate));
  }
  return best;
}

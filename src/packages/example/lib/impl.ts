export interface Tag {
  readonly slug: string;
  readonly label: string;
}

const SEPARATORS = /[^a-z0-9]+/g;
const EDGES = /^-+|-+$/g;

/**
 * Internal implementation. Deliberately more than a pass-through: it owns the
 * slug/label rules so callers never need to know them.
 */
export function normalize(input: string): Tag {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("tag must not be empty");
  }

  const slug = trimmed
    .toLowerCase()
    .replace(SEPARATORS, "-")
    .replace(EDGES, "");

  return {
    slug,
    label: slug
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  };
}

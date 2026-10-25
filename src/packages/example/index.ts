/**
 * Entry point for the `example` package.
 *
 * Everything outside this package — app code, other packages, tests — may
 * import only from here (or another root file of this package). The
 * implementation lives in `lib/` and stays private.
 */
import { normalize, type Tag } from "./lib/impl";

export type { Tag };

export function normalizeTag(input: string): Tag {
  return normalize(input);
}

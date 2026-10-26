import type { DuplicateGroup } from "./types";

/**
 * Drop user-excluded files from duplicate groups. A file the user marked as
 * "not a duplicate" becomes a normal track; if that leaves a group with fewer
 * than two members the group dissolves entirely. When the excluded file was
 * the keeper, the best remaining copy takes over.
 *
 * Lives here (not in the library package) so the browser UI and the server
 * pipeline resolve duplicate groups the same way.
 */
export function applyDedupeIgnores(
  groups: DuplicateGroup[],
  ignores: string[] | undefined,
): DuplicateGroup[] {
  if (!ignores || ignores.length === 0) return groups;
  const ignored = new Set(ignores);
  const result: DuplicateGroup[] = [];
  for (const group of groups) {
    const members = group.members.filter((member) => !ignored.has(member.path));
    if (members.length < 2) continue;
    const keep =
      members.find((member) => member.path === group.keep) ??
      [...members].sort((a, b) =>
        b.qualityScore !== a.qualityScore
          ? b.qualityScore - a.qualityScore
          : b.size - a.size,
      )[0];
    if (!keep) continue;
    const runnerUp = members.find((member) => member.path !== keep.path);
    result.push({
      ...group,
      keep: keep.path,
      members,
      reason: runnerUp
        ? `Keeping ${keep.qualityLabel} instead of ${runnerUp.qualityLabel}`
        : group.reason,
    });
  }
  return result;
}

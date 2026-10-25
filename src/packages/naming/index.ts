/**
 * Pure naming-pattern rendering. Shared by the server (applying matches) and
 * the browser (live preview), so it must not depend on Node APIs.
 */

export interface NamingContext {
  artist?: string;
  albumartist?: string;
  album?: string;
  year?: number | string;
  title?: string;
  track?: number;
  tracktotal?: number;
  disc?: number;
  disctotal?: number;
  format?: string;
  label?: string;
  catno?: string;
  releaseid?: number;
}

export const NAMING_TOKENS = [
  "artist",
  "albumartist",
  "album",
  "year",
  "title",
  "track",
  "tracktotal",
  "disc",
  "disctotal",
  "format",
  "label",
  "catno",
  "releaseid",
] as const;

const TOKEN = /\{([a-zA-Z]+)(?::(\d+))?\}/g;
const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const CONTROL = /[\u0000-\u001f\u007f]/g;

function valueFor(ctx: NamingContext, key: string): string {
  const raw = (ctx as Record<string, unknown>)[key];
  if (raw === undefined || raw === null) return "";
  return String(raw);
}

function tidy(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*-\s*/g, " - ")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .trim();
}

export function sanitizeSegment(input: string): string {
  let value = input
    .normalize("NFC")
    .replace(CONTROL, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();

  if (value.length === 0) value = "Unknown";
  if (WINDOWS_RESERVED.test(value)) value = `_${value}`;
  return value.slice(0, 180);
}

function sanitizeFile(input: string): string {
  let value = input
    .normalize("NFC")
    .replace(CONTROL, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();

  if (value.length === 0) value = "Unknown";
  if (WINDOWS_RESERVED.test(value)) value = `_${value}`;
  return value.slice(0, 180);
}

function substitute(pattern: string, ctx: NamingContext): string {
  return pattern.replace(TOKEN, (_match, key: string, pad?: string) => {
    const value = valueFor(ctx, key.toLowerCase());
    if (!value) return "";
    if (pad) {
      const width = Math.max(1, Math.min(8, Number.parseInt(pad, 10)));
      if (/^\d+$/.test(value)) return value.padStart(width, "0");
    }
    return value;
  });
}

/** Render a folder pattern. `/` creates nested folders; each segment is sanitized. */
export function renderFolderPath(
  pattern: string,
  ctx: NamingContext,
): string {
  const segments = pattern
    .split(/[\\/]+/)
    .map((segment) => tidy(substitute(segment, ctx)))
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .map(sanitizeSegment);

  return segments.length > 0 ? segments.join("/") : "Unknown Album";
}

/** Render a single file name (extension is appended by the caller). */
export function renderFileName(pattern: string, ctx: NamingContext): string {
  return sanitizeFile(tidy(substitute(pattern, ctx)));
}

/** A representative context used for live previews in the UI. */
export const SAMPLE_CONTEXT: NamingContext = {
  artist: "Massive Attack",
  albumartist: "Massive Attack",
  album: "Mezzanine",
  year: 1998,
  title: "Teardrop",
  track: 2,
  tracktotal: 11,
  disc: 1,
  disctotal: 1,
  format: "FLAC",
  label: "Virgin",
  catno: "CDV2859",
  releaseid: 123456,
};

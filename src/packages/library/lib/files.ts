import path from "node:path";

const LEADING_NUMBER = /^\s*(?:[A-Za-z]?)(\d{1,3})\s*[-._)\]]\s*/;
const LEADING_VINYL = /^\s*[A-Za-z]\d{1,2}\s*[-._)\]]\s*/;

/** "01 - Blue Monday [320].flac" → "Blue Monday" */
export function trackTitleFromFileName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  return base
    .replace(LEADING_VINYL, "")
    .replace(LEADING_NUMBER, "")
    .replace(/_/g, " ")
    .replace(/\s*[\[(](?:320|192|128|v0|flac|mp3|aac|web|hq|cd rip|vinyl rip)[\])]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function trackNumberFromFileName(fileName: string): number | undefined {
  const base = path.basename(fileName, path.extname(fileName));
  const match = LEADING_NUMBER.exec(base);
  if (!match?.[1]) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : undefined;
}

export const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".m4b",
  ".mp4",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".wav",
  ".aiff",
  ".aif",
  ".ape",
  ".wv",
  ".wma",
]);

export const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
]);

export function isAudioFile(fileName: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function mimeForImage(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".tif" || extension === ".tiff") return "image/tiff";
  return "image/jpeg";
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function naturalCompare(a: string, b: string): number {
  return natural.compare(a, b);
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeDiscogsToken } from "../../discogs";
import type {
  CoverMode,
  DedupeMode,
  PublicSettings,
  SettingsUpdate,
  TransferMode,
} from "../../model/types";

export interface StoredSettings {
  rootFolder: string;
  destinationFolder: string;
  autoThreshold: number;
  autoMargin: number;
  candidateCount: number;
  coverMode: CoverMode;
  transferMode: TransferMode;
  dedupeMode: DedupeMode;
  folderPattern: string;
  trackPattern: string;
  discogsToken: string;
  discogsUser?: string;
}

export const DEFAULT_SETTINGS: StoredSettings = {
  rootFolder: "",
  destinationFolder: "",
  autoThreshold: 0.86,
  autoMargin: 0.06,
  candidateCount: 4,
  coverMode: "both",
  transferMode: "copy",
  dedupeMode: "hide",
  folderPattern: "{albumartist} - {year} - {album}",
  trackPattern: "{track:02} - {title}",
  discogsToken: "",
};

const COVER_MODES: CoverMode[] = ["copy", "embed", "both"];
const TRANSFER_MODES: TransferMode[] = ["copy", "move"];
const DEDUPE_MODES: DedupeMode[] = ["off", "hide", "delete"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function toPublicSettings(settings: StoredSettings): PublicSettings {
  return {
    rootFolder: settings.rootFolder,
    destinationFolder: settings.destinationFolder,
    autoThreshold: settings.autoThreshold,
    autoMargin: settings.autoMargin,
    candidateCount: settings.candidateCount,
    coverMode: settings.coverMode,
    transferMode: settings.transferMode,
    dedupeMode: settings.dedupeMode,
    folderPattern: settings.folderPattern,
    trackPattern: settings.trackPattern,
    hasToken: settings.discogsToken.length > 0,
    tokenHint: settings.discogsToken
      ? `••••${settings.discogsToken.slice(-4)}`
      : undefined,
    tokenLength: settings.discogsToken.length || undefined,
    discogsUser: settings.discogsUser,
  };
}

export function mergeSettings(
  current: StoredSettings,
  update: SettingsUpdate,
): StoredSettings {
  const next: StoredSettings = { ...current };

  const root = asString(update.rootFolder);
  if (root !== undefined) next.rootFolder = root;
  const destination = asString(update.destinationFolder);
  if (destination !== undefined) next.destinationFolder = destination;

  const threshold = asNumber(update.autoThreshold);
  if (threshold !== undefined) next.autoThreshold = clamp(threshold, 0.5, 1);
  const margin = asNumber(update.autoMargin);
  if (margin !== undefined) next.autoMargin = clamp(margin, 0, 0.5);
  const candidates = asNumber(update.candidateCount);
  if (candidates !== undefined) {
    next.candidateCount = Math.round(clamp(candidates, 1, 10));
  }

  if (update.coverMode && COVER_MODES.includes(update.coverMode)) {
    next.coverMode = update.coverMode;
  }
  if (update.transferMode && TRANSFER_MODES.includes(update.transferMode)) {
    next.transferMode = update.transferMode;
  }
  if (update.dedupeMode && DEDUPE_MODES.includes(update.dedupeMode)) {
    next.dedupeMode = update.dedupeMode;
  }

  const folderPattern = asString(update.folderPattern);
  if (folderPattern) next.folderPattern = folderPattern;
  const trackPattern = asString(update.trackPattern);
  if (trackPattern) next.trackPattern = trackPattern;

  if (update.clearToken) {
    next.discogsToken = "";
    next.discogsUser = undefined;
  } else if (typeof update.discogsToken === "string") {
    const token = normalizeDiscogsToken(update.discogsToken);
    if (token) next.discogsToken = token;
  }

  return next;
}

export class SettingsStore {
  private readonly filePath: string;
  settings: StoredSettings;

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, "settings.json");
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async load(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoredSettings>;
      this.settings = mergeSettings(
        { ...DEFAULT_SETTINGS },
        {
          rootFolder: raw.rootFolder,
          destinationFolder: raw.destinationFolder,
          autoThreshold: raw.autoThreshold,
          autoMargin: raw.autoMargin,
          candidateCount: raw.candidateCount,
          coverMode: raw.coverMode,
          transferMode: raw.transferMode,
          dedupeMode: raw.dedupeMode,
          folderPattern: raw.folderPattern,
          trackPattern: raw.trackPattern,
          discogsToken: raw.discogsToken,
        },
      );
      if (typeof raw.discogsUser === "string") {
        this.settings.discogsUser = raw.discogsUser;
      }
    } catch {
      // first run / unreadable settings use defaults
    }

    // Container-friendly defaults. Values from the settings file always win;
    // these only fill blank paths on first boot.
    const envRoot = process.env.DCTAGGER_ROOT_FOLDER?.trim();
    if (!this.settings.rootFolder && envRoot) this.settings.rootFolder = envRoot;
    const envDestination = process.env.DCTAGGER_DESTINATION_FOLDER?.trim();
    if (!this.settings.destinationFolder && envDestination) {
      this.settings.destinationFolder = envDestination;
    }
  }

  async update(update: SettingsUpdate): Promise<StoredSettings> {
    this.settings = mergeSettings(this.settings, update);
    await this.save();
    return this.settings;
  }

  async save(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}

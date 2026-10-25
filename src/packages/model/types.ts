/**
 * Domain model shared by the server, the tagging engine, and the browser UI.
 * This is a public entry point of the `model` package.
 */

export type AlbumStatus =
  | "scanning"
  | "auto-matched"
  | "needs-review"
  | "confirmed"
  | "skipped"
  | "applied"
  | "error";

export type CoverMode = "copy" | "embed" | "both";
export type TransferMode = "copy" | "move";
export type DedupeMode = "off" | "hide" | "delete";

export interface LocalTrack {
  path: string;
  fileName: string;
  size: number;
  format: string;
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  track?: number;
  disc?: number;
  year?: number;
  hasArt: boolean;
  genres?: string[];
  bitrate?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  lossless?: boolean;
  /** Higher is better; used to pick the keeper of a duplicate group. */
  qualityScore?: number;
  qualityLabel?: string;
}

export interface LocalImage {
  path: string;
  fileName: string;
  mimeType: string;
  source: "folder" | "embedded";
  size?: number;
}

export interface AlbumHints {
  artist?: string;
  album?: string;
  year?: number;
  genres?: string[];
  source: "tags" | "folder" | "mixed";
}

/** Album metadata fetched from Deezer, associated with a Discogs release. */
export interface DeezerReleaseMatch {
  releaseId: number;
  albumId: number;
  title: string;
  artist?: string;
  genres: string[];
  label?: string;
  releaseDate?: string;
  url?: string;
}

/** Release-group metadata fetched from MusicBrainz. */
export interface MusicBrainzReleaseMatch {
  releaseId: number;
  releaseGroupId: string;
  title: string;
  artist?: string;
  genres: string[];
  score?: number;
}

export interface ReleaseArtist {
  id?: number;
  name: string;
  join?: string;
}

export interface ReleaseTrack {
  /** 0-based index in the cleaned tracklist. */
  index: number;
  position: string;
  title: string;
  duration?: string;
  artists: string[];
  disc: number;
  trackNumber: number;
}

export interface ReleaseImage {
  uri: string;
  uri150?: string;
  width: number;
  height: number;
  type: "primary" | "secondary";
}

export interface ReleaseLabel {
  name: string;
  catno?: string;
}

export interface ReleaseFormat {
  name: string;
  qty?: string;
  descriptions: string[];
}

export interface DiscogsRelease {
  id: number;
  title: string;
  artists: ReleaseArtist[];
  year?: number;
  released?: string;
  country?: string;
  genres: string[];
  styles: string[];
  labels: ReleaseLabel[];
  formats: ReleaseFormat[];
  tracklist: ReleaseTrack[];
  images: ReleaseImage[];
  uri: string;
  thumb?: string;
  coverImage?: string;
  resourceUrl?: string;
  masterId?: number;
}

export interface ScoreBreakdown {
  album: number;
  artist: number;
  trackCount: number;
  trackTitles: number;
  year: number;
}

export interface MatchCandidate {
  release: DiscogsRelease;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface DuplicateMember {
  path: string;
  fileName: string;
  format: string;
  qualityScore: number;
  qualityLabel: string;
  size: number;
}

export interface DuplicateGroup {
  /** Stable key derived from the track identity. */
  key: string;
  /** File that will be kept (and tagged). */
  keep: string;
  members: DuplicateMember[];
  reason: string;
}

export interface TrackAssignment {
  filePath: string;
  /** Index into the selected release's tracklist, or null to skip the file. */
  trackIndex: number | null;
  /** Initial auto-mapping confidence, if any. */
  confidence?: number;
}

export interface AppliedInfo {
  targetFolder: string;
  tagged: number;
  files: number;
  deduplicated: number;
  skipped?: number;
  errors: string[];
  at: string;
}

export interface AlbumFolder {
  id: string;
  path: string;
  folderName: string;
  tracks: LocalTrack[];
  images: LocalImage[];
  hints: AlbumHints;
  status: AlbumStatus;
  candidates: MatchCandidate[];
  selectedReleaseId?: number;
  mapping: TrackAssignment[];
  /** Groups of files that represent the same track in this folder. */
  duplicates: DuplicateGroup[];
  /** Deezer metadata used as a genre fallback for the selected release. */
  deezer?: DeezerReleaseMatch;
  /** MusicBrainz metadata used when Discogs and Deezer have no genre. */
  musicbrainz?: MusicBrainzReleaseMatch;
  autoMatched: boolean;
  confidence?: number;
  /** Local image path chosen as the cover instead of the Discogs image. */
  coverOverride?: string;
  error?: string;
  applied?: AppliedInfo;
  updatedAt: string;
}

export interface ScanSummary {
  total: number;
  autoMatched: number;
  needsReview: number;
  confirmed: number;
  skipped: number;
  applied: number;
  errors: number;
}

export interface ScanState {
  phase: "idle" | "scanning" | "done" | "cancelled" | "error";
  rootFolder: string;
  total: number;
  done: number;
  currentFolder?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  summary: ScanSummary;
}

export interface ApplyResult {
  albumId: string;
  folderName: string;
  ok: boolean;
  targetFolder?: string;
  tagged: number;
  files: number;
  deduplicated: number;
  skipped?: number;
  errors: string[];
}

export interface ApplyState {
  phase: "idle" | "running" | "done" | "cancelled" | "error";
  total: number;
  done: number;
  current?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  results: ApplyResult[];
}

export interface DiscogsIdentity {
  id: number;
  username: string;
  resourceUrl: string;
}

export interface PublicSettings {
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
  hasToken: boolean;
  tokenHint?: string;
  tokenLength?: number;
  discogsUser?: string;
}

export interface SettingsUpdate {
  rootFolder?: string;
  destinationFolder?: string;
  autoThreshold?: number;
  autoMargin?: number;
  candidateCount?: number;
  coverMode?: CoverMode;
  transferMode?: TransferMode;
  dedupeMode?: DedupeMode;
  folderPattern?: string;
  trackPattern?: string;
  /** Only sent when the user wants to change the stored token. */
  discogsToken?: string;
  clearToken?: boolean;
}

export interface SessionView {
  scan: ScanState;
  apply: ApplyState;
  albums: AlbumFolder[];
}

export interface FolderListing {
  path: string;
  parent: string | null;
  directories: string[];
  audioFiles: number;
}

export interface ApiError {
  error: string;
}

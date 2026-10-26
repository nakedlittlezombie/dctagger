export {
  autoMap,
  unmappedFiles,
} from "./lib/trackmap";
export type { LocalMatchInput, LocalMatchTrack, ScoreResult, ConfidenceOptions } from "./lib/scoring";
export { isHighConfidence, rankReleases, scoreRelease } from "./lib/scoring";
export {
  albumSimilarity,
  artistSimilarity,
  bestSimilarity,
  normalizeAlbum,
  normalizeText,
  normalizeTrackTitle,
  similarity,
  trackSimilarity,
} from "./lib/similarity";
export {
  canMergeAlbums,
  compareAlbumsForMerge,
  mergeAlbumKey,
} from "./lib/merge";
export type { MergeComparison } from "./lib/merge";

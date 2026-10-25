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

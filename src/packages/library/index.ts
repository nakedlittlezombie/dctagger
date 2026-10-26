export {
  albumIdFor,
  containerHintsFor,
  enumerateAlbumFolders,
  expandHome,
  folderHasAudio,
  parseFolderName,
  scanAlbumFolder,
} from "./lib/scan";
export type { AlbumLocation, FolderNameHints, ScanOptions } from "./lib/scan";
export { applyAlbum } from "./lib/apply";
export type { ApplyAlbumOptions, CoverArt } from "./lib/apply";
export {
  compareAlbumsForMerge,
  findMergeGroups,
  mergeAlbumKey,
  mergeAlbums,
} from "./lib/merge";
export type { MergeComparison } from "./lib/merge";
export {
  chooseKeeper,
  detectDuplicates,
  duplicatePaths,
  qualityOf,
  uniqueTracks,
} from "./lib/dedupe";
export {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  isAudioFile,
  isImageFile,
  mimeForImage,
  naturalCompare,
  trackNumberFromFileName,
  trackTitleFromFileName,
} from "./lib/files";

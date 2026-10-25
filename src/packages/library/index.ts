export {
  albumIdFor,
  enumerateAlbumFolders,
  expandHome,
  folderHasAudio,
  parseFolderName,
  scanAlbumFolder,
} from "./lib/scan";
export type { AlbumLocation, ScanOptions } from "./lib/scan";
export { applyAlbum } from "./lib/apply";
export type { ApplyAlbumOptions, CoverArt } from "./lib/apply";
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

import type {
  DiscogsRelease,
  ReleaseArtist,
  ReleaseFormat,
  ReleaseImage,
  ReleaseLabel,
  ReleaseTrack,
} from "../../model/types";
import { cleanArtistName } from "../../model/artist";

export interface RawSearchResult {
  id: number;
  type: string;
  master_id?: number;
  title: string;
  year?: string;
  format?: string[];
  label?: string[];
  genre?: string[];
  style?: string[];
  country?: string;
  catno?: string;
  cover_image?: string;
  thumb?: string;
  resource_url?: string;
}

export interface RawSearchResponse {
  pagination?: { page: number; pages: number; per_page: number; items: number };
  results?: RawSearchResult[];
}

export interface RawReleaseTrack {
  position?: string;
  type_?: string;
  title?: string;
  duration?: string;
  artists?: Array<{ name: string; anv?: string; join?: string }>;
}

export interface RawRelease {
  id: number;
  title: string;
  year?: number;
  released?: string;
  country?: string;
  artists?: Array<{ id?: number; name: string; anv?: string; join?: string }>;
  labels?: Array<{ name: string; catno?: string }>;
  formats?: Array<{ name: string; qty?: string; descriptions?: string[] }>;
  genres?: string[];
  styles?: string[];
  tracklist?: RawReleaseTrack[];
  images?: Array<{
    type?: string;
    uri?: string;
    uri150?: string;
    width?: number;
    height?: number;
  }>;
  uri?: string;
  thumb?: string;
  resource_url?: string;
  master_id?: number;
}

export interface SearchReleaseSummary {
  id: number;
  title: string;
  year?: number;
  coverImage?: string;
  thumb?: string;
  formatSummary?: string;
  label?: string;
  catno?: string;
  country?: string;
  masterId?: number;
}

const SIDE_LETTER = /^([A-Za-z])(\d+)$/;
const DISC_TRACK = /^(\d+)[-.](\d+)$/;
const DISC_SIDE_TRACK = /^(\d+)[-.]([A-Za-z])(\d+)$/;
const NUMBER = /^(\d+)$/;

function cleanArtist(name: string): string {
  return cleanArtistName(name);
}

function buildTracklist(raw: RawReleaseTrack[] | undefined): ReleaseTrack[] {
  const entries = (raw ?? []).filter(
    (track) =>
      track.type_ !== "heading" &&
      track.type_ !== "index" &&
      Boolean(track.title?.trim()),
  );

  const sides = new Set<string>();
  for (const track of entries) {
    const match = SIDE_LETTER.exec(track.position?.trim() ?? "");
    if (match?.[1]) sides.add(match[1].toUpperCase());
  }
  const multiSideVinyl = sides.size > 2;
  const sortedSides = [...sides].sort();

  let disc = 1;
  let trackInDisc = 0;
  let previousDisc = 1;

  return entries.map((track, index) => {
    const position = track.position?.trim() ?? "";
    let trackNumber = index + 1;

    const discTrack = DISC_TRACK.exec(position);
    const discSide = DISC_SIDE_TRACK.exec(position);
    const sideTrack = SIDE_LETTER.exec(position);
    const plain = NUMBER.exec(position);

    if (discTrack?.[1] && discTrack[2]) {
      disc = Number.parseInt(discTrack[1], 10);
      trackNumber = Number.parseInt(discTrack[2], 10);
    } else if (discSide?.[1] && discSide[3]) {
      disc = Number.parseInt(discSide[1], 10);
      trackNumber = Number.parseInt(discSide[3], 10);
    } else if (sideTrack?.[1] && sideTrack[2]) {
      const side = sideTrack[1].toUpperCase();
      disc = multiSideVinyl
        ? Math.floor(sortedSides.indexOf(side) / 2) + 1
        : 1;
      trackNumber = Number.parseInt(sideTrack[2], 10);
    } else if (plain?.[1]) {
      disc = 1;
      trackNumber = Number.parseInt(plain[1], 10);
    }

    if (disc !== previousDisc) {
      trackInDisc = 0;
      previousDisc = disc;
    }
    trackInDisc += 1;
    if (multiSideVinyl) {
      trackNumber = trackInDisc;
    }

    return {
      index,
      position,
      title: track.title?.trim() ?? `Track ${index + 1}`,
      duration: track.duration?.trim() || undefined,
      artists: (track.artists ?? []).map((artist) => cleanArtist(artist.anv || artist.name)),
      disc,
      trackNumber,
    };
  });
}

function buildArtists(raw: RawRelease["artists"]): ReleaseArtist[] {
  return (raw ?? []).map((artist) => ({
    id: artist.id,
    name: cleanArtist(artist.anv || artist.name),
    join: artist.join,
  }));
}

function buildImages(raw: RawRelease["images"]): ReleaseImage[] {
  return (raw ?? [])
    .filter((image): image is { type?: string; uri: string; uri150?: string; width?: number; height?: number } =>
      Boolean(image.uri),
    )
    .map((image) => ({
      uri: image.uri,
      uri150: image.uri150,
      width: image.width ?? 0,
      height: image.height ?? 0,
      type: image.type === "primary" ? ("primary" as const) : ("secondary" as const),
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "primary" ? -1 : 1;
      return b.width * b.height - a.width * a.height;
    });
}

function buildFormats(raw: RawRelease["formats"]): ReleaseFormat[] {
  return (raw ?? []).map((format) => ({
    name: format.name ?? "Unknown",
    qty: format.qty,
    descriptions: format.descriptions ?? [],
  }));
}

export function mapRelease(raw: RawRelease, fallbackCover?: string): DiscogsRelease {
  const images = buildImages(raw.images);
  return {
    id: raw.id,
    title: raw.title?.trim() ?? "Unknown release",
    artists: buildArtists(raw.artists),
    year: raw.year,
    released: raw.released,
    country: raw.country,
    genres: raw.genres ?? [],
    styles: raw.styles ?? [],
    labels: (raw.labels ?? []).map<ReleaseLabel>((label) => ({
      name: label.name ?? "",
      catno: label.catno,
    })),
    formats: buildFormats(raw.formats),
    tracklist: buildTracklist(raw.tracklist),
    images,
    uri: raw.uri ?? `https://www.discogs.com/release/${raw.id}`,
    thumb: raw.thumb,
    coverImage: images[0]?.uri ?? fallbackCover,
    resourceUrl: raw.resource_url,
    masterId: raw.master_id,
  };
}

export function mapSearchResult(raw: RawSearchResult): SearchReleaseSummary {
  return {
    id: raw.id,
    title: raw.title,
    year: raw.year ? Number.parseInt(raw.year, 10) : undefined,
    coverImage: raw.cover_image || undefined,
    thumb: raw.thumb || undefined,
    formatSummary: (raw.format ?? []).join(", "),
    label: raw.label?.[0],
    catno: raw.catno,
    country: raw.country,
    masterId: raw.master_id,
  };
}

import type {
  AlbumFolder,
  DiscogsIdentity,
  FolderListing,
  PublicSettings,
  SessionView,
  SettingsUpdate,
} from "../packages/model/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export interface ConfirmInput {
  releaseId: number;
  mapping: Array<{ filePath: string; trackIndex: number | null }>;
  coverOverride: string | null;
}

export const api = {
  session: () => request<SessionView>("/api/session"),
  settings: () => request<PublicSettings>("/api/settings"),
  saveSettings: (update: SettingsUpdate) =>
    request<PublicSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(update),
    }),
  testDiscogs: (token?: string) =>
    request<DiscogsIdentity>("/api/discogs/test", {
      method: "POST",
      body: JSON.stringify(token ? { token } : {}),
    }),
  scan: (rootFolder: string) =>
    request<SessionView>("/api/scan", {
      method: "POST",
      body: JSON.stringify({ rootFolder }),
    }),
  cancelScan: () => request<SessionView>("/api/scan/cancel", { method: "POST" }),
  resetSession: () => request<SessionView>("/api/session/reset", { method: "POST" }),
  listFolders: (path?: string) => {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return request<FolderListing>(`/api/fs${query}`);
  },
  lookup: (albumId: string, query: string, source: "discogs" | "deezer" = "discogs") =>
    request<AlbumFolder>(`/api/albums/${albumId}/lookup`, {
      method: "POST",
      body: JSON.stringify({ query, source }),
    }),
  confirm: (albumId: string, input: ConfirmInput) =>
    request<AlbumFolder>(`/api/albums/${albumId}/confirm`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  skip: (albumId: string) =>
    request<AlbumFolder>(`/api/albums/${albumId}/skip`, { method: "POST" }),
  reopen: (albumId: string) =>
    request<AlbumFolder>(`/api/albums/${albumId}/reopen`, { method: "POST" }),
  setDedupeKeeper: (albumId: string, key: string, keepPath: string) =>
    request<AlbumFolder>(`/api/albums/${albumId}/dedupe`, {
      method: "POST",
      body: JSON.stringify({ key, keepPath }),
    }),
  apply: () => request<SessionView>("/api/apply", { method: "POST" }),
  cancelApply: () =>
    request<SessionView>("/api/apply/cancel", { method: "POST" }),
};

export function artUrl(albumId: string, index: number): string {
  return `/api/albums/${encodeURIComponent(albumId)}/art/${index}`;
}

export function imageUrl(url: string): string {
  return `/api/image?url=${encodeURIComponent(url)}`;
}

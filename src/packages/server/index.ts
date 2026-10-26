import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { DiscogsError } from "../discogs";
import type { SettingsUpdate } from "../model/types";
import { AppError, AppState } from "./lib/state";

export interface ServerOptions {
  dataDir?: string;
  webRoot?: string;
  logger?: boolean;
}

interface ScanBody {
  rootFolder?: string;
}

interface LookupBody {
  source?: "discogs" | "deezer" | "link";
  artist?: string;
  album?: string;
  url?: string;
}

interface ConfirmBody {
  releaseId?: number;
  mapping?: Array<{ filePath?: string; trackIndex?: number | null }>;
  coverOverride?: string | null;
}

interface DedupeBody {
  key?: string;
  keepPath?: string;
}

interface DedupeIgnoreBody {
  path?: string;
  ignored?: boolean;
}

interface MergeBody {
  albumIds?: string[];
}

interface TestBody {
  token?: string;
}

function bodyOf<T>(request: { body: unknown }): T {
  return (request.body ?? {}) as T;
}

export async function buildServer(options: ServerOptions = {}): Promise<{
  app: FastifyInstance;
  state: AppState;
}> {
  const state = await AppState.create(options.dataDir);
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send({ error: error.message });
    }
    if (error instanceof DiscogsError) {
      const status = error.status === 401 || error.status === 403 ? 401 : 502;
      return reply.code(status).send({ error: error.message });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return reply.code(500).send({ error: message });
  });

  app.get("/api/health", async () => ({
    ok: true,
    hasToken: state.publicSettings().hasToken,
  }));

  app.get("/api/settings", async () => state.publicSettings());

  app.put<{ Body: SettingsUpdate }>("/api/settings", async (request) => {
    const body = bodyOf<SettingsUpdate>(request);
    return state.updateSettings(body);
  });

  app.post<{ Body: TestBody }>("/api/discogs/test", async (request) => {
    const body = bodyOf<TestBody>(request);
    return state.testDiscogs(typeof body.token === "string" && body.token.trim() ? body.token : undefined);
  });

  app.get("/api/session", async () => state.session);

  app.post("/api/session/reset", async () => state.resetSession());

  app.get<{ Querystring: { path?: string } }>("/api/fs", async (request) => {
    return state.listFolders(request.query.path);
  });

  app.post<{ Body: ScanBody }>("/api/scan", async (request) => {
    const body = bodyOf<ScanBody>(request);
    return state.beginScan(body.rootFolder);
  });

  app.post("/api/scan/cancel", async () => state.cancelScan());

  app.get<{ Params: { id: string } }>("/api/albums/:id", async (request) => {
    return state.albumOrThrow(request.params.id);
  });

  app.post<{ Params: { id: string }; Body: LookupBody }>(
    "/api/albums/:id/lookup",
    async (request) => {
      const body = bodyOf<LookupBody>(request);
      const source =
        body.source === "deezer" || body.source === "link" ? body.source : "discogs";
      return state.lookup(request.params.id, {
        source,
        artist: body.artist,
        album: body.album,
        url: body.url,
      });
    },
  );

  app.post<{ Params: { id: string }; Body: ConfirmBody }>(
    "/api/albums/:id/confirm",
    async (request) => {
      const body = bodyOf<ConfirmBody>(request);
      const releaseId = Number(body.releaseId);
      if (!Number.isInteger(releaseId) || releaseId === 0) {
        throw new AppError(400, "A release must be selected");
      }
      return state.confirm(request.params.id, {
        releaseId,
        mapping: (body.mapping ?? [])
          .filter((entry) => typeof entry.filePath === "string")
          .map((entry) => ({
            filePath: entry.filePath as string,
            trackIndex: entry.trackIndex === null || entry.trackIndex === undefined
              ? null
              : Number(entry.trackIndex),
          })),
        coverOverride: body.coverOverride,
      });
    },
  );

  app.post<{ Params: { id: string } }>("/api/albums/:id/skip", async (request) => {
    return state.skip(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/api/albums/:id/reopen", async (request) => {
    return state.reopen(request.params.id);
  });

  app.post<{ Params: { id: string }; Body: DedupeBody }>(
    "/api/albums/:id/dedupe",
    async (request) => {
      const body = bodyOf<DedupeBody>(request);
      if (!body.key || !body.keepPath) {
        throw new AppError(400, "Duplicate group and keeper are required");
      }
      return state.setDedupeKeeper(request.params.id, body.key, body.keepPath);
    },
  );

  app.post<{ Params: { id: string }; Body: DedupeIgnoreBody }>(
    "/api/albums/:id/dedupe/ignore",
    async (request) => {
      const body = bodyOf<DedupeIgnoreBody>(request);
      if (typeof body.path !== "string" || body.path.length === 0) {
        throw new AppError(400, "A file path is required");
      }
      return state.setDedupeIgnore(request.params.id, body.path, body.ignored !== false);
    },
  );

  app.post<{ Body: MergeBody }>("/api/albums/merge", async (request) => {
    const body = bodyOf<MergeBody>(request);
    const albumIds = (Array.isArray(body.albumIds) ? body.albumIds : []).filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    return state.mergeAlbums(albumIds);
  });

  app.post<{ Params: { id: string } }>(
    "/api/albums/:id/unmerge",
    async (request) => state.unmergeAlbum(request.params.id),
  );

  app.get<{ Params: { id: string; index: string } }>(
    "/api/albums/:id/art/:index",
    async (request, reply) => {
      const album = state.albumOrThrow(request.params.id);
      const index = Number.parseInt(request.params.index, 10);
      const image = album.images[index];
      if (!image) throw new AppError(404, "Artwork not found");
      try {
        const data = await readFile(image.path);
        return reply
          .type(image.mimeType)
          .header("Cache-Control", "no-cache")
          .send(data);
      } catch {
        throw new AppError(404, "Artwork file is no longer available");
      }
    },
  );

  app.get<{ Querystring: { url?: string } }>("/api/image", async (request, reply) => {
    const url = request.query.url;
    if (!url) throw new AppError(400, "Missing image URL");
    const downloaded = await state.imageClient().downloadImage(url);
    return reply
      .type(downloaded.contentType)
      .header("Cache-Control", "public, max-age=86400")
      .send(downloaded.data);
  });

  app.post("/api/apply", async () => state.beginApply());

  app.post("/api/apply/cancel", async () => state.cancelApply());

  const webRoot = path.resolve(
    options.webRoot ?? path.join(process.cwd(), "dist", "web"),
  );
  const hasWeb = existsSync(path.join(webRoot, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
      setHeaders(response, filePath) {
        if (filePath.endsWith("index.html")) {
          response.header("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          response.header("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    if (hasWeb && request.method === "GET") {
      return reply
        .header("Cache-Control", "no-cache, no-store, must-revalidate")
        .sendFile("index.html");
    }
    return reply
      .code(404)
      .type("text/plain")
      .send(
        "DCTagger API is running. Start the UI with `npm run dev:web` or build it with `npm run build:web`.",
      );
  });

  return { app, state };
}

export async function startServer(options: ServerOptions & { port?: number; host?: string } = {}) {
  const { app, state } = await buildServer(options);
  const port = options.port ?? Number(process.env.PORT ?? 4780);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  await app.listen({ port, host });
  return { app, state, url: `http://${host}:${port}` };
}

# DCTagger

**A local, self-hosted Discogs music tagger with a review workspace, duplicate cleanup,
cover-art handling, and a batch tagging pipeline.**

Point DCTagger at a music library. It scans album folders, matches them against Discogs,
auto-approves high-confidence results, and presents everything else one album at a time.
Once you confirm the matches, it writes tags, fetches artwork, resolves duplicate rips,
renames folders and tracks, and copies or moves the result into your destination.

The interface is based on the **Obsidian Vinyl Precision** design system from the Stitch
export in [`stitch_export/`](stitch_export/).

## Highlights

- Scans flat libraries (`root/Album`) **or** artist libraries (`root/Artist/Album`), including
  mixed layouts.
- Reads tags and filenames for hints; falls back to parent folder names.
- Discogs search + release scoring based on artist, album, year, track count, and track titles.
- Auto-match threshold and runner-up margin, both configurable.
- One-album-at-a-time review with:
  - top Discogs candidates and cover previews
  - full release tracklist
  - folder and embedded artwork inspection
  - manual Discogs **or Deezer** lookup
  - per-file → track mapping with confidence suggestions
  - metadata preview, including the effective genre and its source
- Duplicate detection per folder with automatic quality ranking
  (lossless, bit depth, sample rate, bitrate) and manual keeper override.
- Writes tags for MP3, FLAC, M4A/MP4, OGG/Opus, WAV, AIFF, APE, WMA, and more
  (`node-taglib-sharp`).
- Downloads cover art and either embeds it, saves `cover.*`, or both.
- Copy **or** move mode, with configurable folder/track naming patterns.
- Only files mapped to a Discogs track are applied; unmatched audio stays in the source.
- Optional local-art override instead of the Discogs cover.
- Hardened Docker image, separate persistent config/cache mounts, PUID/PGID support.

## Requirements

- **Node.js 20.19+** (Node 24 recommended; the Docker image uses Node 24).
- A **Discogs Personal Access Token**:
  <https://www.discogs.com/settings/developers> → **Personal Access Token**.
  Do not use the Consumer Key/Secret or an OAuth access token.
- Docker 24+ only if you want to run the container.

## Quick start

```sh
git clone git@github.com:nakedlittlezombie/dctagger.git
cd dctagger
npm install
npm run dev
```

Open <http://localhost:5173>, go to **Settings**, paste the Discogs token, and click
**Test & save**. Then scan your library.

For a production-style local run:

```sh
npm start        # builds UI + bundled server, then serves http://127.0.0.1:4780
```

## How it works

1. **Scan** — finds every folder that directly contains audio. Albums can live at
   `root/Album`, `root/Artist/Album`, or a mix of both. Artist-folder names become fallback
   hints when tags are missing.
2. **Match** — scores Discogs releases using artist, album title, year, track count, and
   track titles. A match is auto-approved only when it clears the confidence threshold, leads
   the runner-up by the configured margin, and has a matching track count.
3. **Review** — unmatched or uncertain albums are queued. Each screen shows the candidates,
   selected release, canonical tracklist, local files, artwork, tag preview, and duplicate
   groups. Map files to tracks directly; auto-mapping is editable. If Discogs has no match,
   the lookup field offers both **Discogs** and **Deezer** searches.
4. **Dedupe** — files with the same track number/title and a compatible duration are grouped.
   The best-quality copy wins. Choose:
   - **off** — leave duplicate copies untouched in the source
   - **hide** — leave losing copies in the source, don't transfer them
   - **delete** — delete losing copies after the keeper is transferred
5. **Apply** — for every confirmed or auto-matched album:
   - writes canonical tags
   - fetches the cover and embeds and/or saves it
   - resolves duplicates
   - renames folder/tracks from your pattern
   - copies or moves mapped files into the destination
   - leaves unmatched audio in the source
   - transfers non-audio extras such as cue/log/artwork files

If tagging fails, the operation is rolled back per file: a copy-mode destination copy is
removed, or a move-mode file is returned to the source.

## Metadata and genre

Discogs is the authoritative source for release and track metadata.

Genre tags use this fallback chain:

1. **Discogs** genres + styles
2. **Deezer** album genre (public API, no credentials)
3. **MusicBrainz** release-group genres (public API, no credentials)
4. Existing **local genre tags** in the folder

Deezer is only queried automatically for genre when Discogs has neither genres nor styles.
MusicBrainz is only queried automatically when both Discogs and Deezer return no genre. Both
are best-effort enrichments: failures are ignored, responses are cached for 30 days, and **no
audio is downloaded** from either service.

Deezer is also available as a **manual lookup source**. When Discogs has no suitable release,
the review screen can search Deezer and use its album metadata and tracklist for the match,
cover art, and tags. Deezer-sourced matches are marked `dz…` in the UI and write a Deezer
release reference into the tag comment.

The metadata preview shows the effective genre and its source (`Discogs`, `Deezer`,
`MusicBrainz`, or `Local tags`). The same value is written to the file tags.

Deemix is not used; it is an unofficial downloader and is not a metadata API.

## Naming patterns

Available tokens:

`{artist}`, `{albumartist}`, `{album}`, `{year}`, `{title}`, `{track}`, `{tracktotal}`,
`{disc}`, `{disctotal}`, `{format}`, `{label}`, `{catno}`, `{releaseid}`.

Use `{track:02}` for zero-padding. The folder pattern may contain `/` to create
subdirectories. Illegal filename characters are sanitized, and all writes are constrained to
the destination root.

Defaults:

```text
folder: {albumartist} - {year} - {album}
track:  {track:02} - {title}
```

## Docker

Two compose files are provided:

- `docker-compose.yml` — runs the published image `nakedzombie/dctagger:latest`
- `docker-compose.dev.yml` — builds the image locally from the Docker Hardened Images base

### Run the published image

```sh
cp example.env .env
# edit .env: host port/bind, music source, destination, config/cache, PUID/PGID

mkdir -p config cache music output
sudo chown -R "$(id -u):$(id -g)" config cache music output

docker compose pull
docker compose up -d
```

Open <http://127.0.0.1:4780> by default.

### Build the image locally

The build uses Docker Hardened Images from the
[DHI catalog](https://hub.docker.com/hardened-images/catalog/dhi/node):

- build: `dhi.io/node:24-alpine3.24-dev`
- runtime: `dhi.io/node:24-alpine3.24` — non-root, no shell

Authenticate to the DHI registry first, then build and push:

```sh
docker login dhi.io
docker compose -f docker-compose.dev.yml build
docker push nakedzombie/dctagger:latest
```

Or start the locally built version directly:

```sh
docker compose -f docker-compose.dev.yml up -d
```

The service runs with a read-only root filesystem, all capabilities dropped,
`no-new-privileges`, and a `/tmp` tmpfs. Only these mounts are writable:

| Host path | Container | Purpose |
| --- | --- | --- |
| `DCTAGGER_CONFIG_DIR` (`./config`) | `/data` | settings, session, review state |
| `DCTAGGER_CACHE_DIR` (`./cache`) | `/data/cache` | Discogs/Deezer/MusicBrainz caches, art previews |
| `DCTAGGER_MUSIC_DIR` (`./music`) | `/music` | source library (writable for move/delete) |
| `DCTAGGER_OUTPUT_DIR` (`./output`) | `/output` | tagged output |

The cache can be cleared independently of settings and review decisions.

### `.env` variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DCTAGGER_BIND` | `127.0.0.1` | Host interface; use `0.0.0.0` only for LAN access |
| `DCTAGGER_PORT` | `4780` | Host port mapped to container port `4780` |
| `DCTAGGER_CONFIG_DIR` | `./config` | Persistent configuration mount |
| `DCTAGGER_CACHE_DIR` | `./cache` | Persistent cache mount |
| `DCTAGGER_MUSIC_DIR` | `./music` | Source library mount |
| `DCTAGGER_OUTPUT_DIR` | `./output` | Destination mount |
| `PUID` / `PGID` | `1000` / `1000` | Container user; must own the host directories |
| `TZ` | `Etc/UTC` | Container timezone |
| `NODE_DEV_IMAGE` | DHI Node dev tag | Optional mirror override (build only) |
| `NODE_RUNTIME_IMAGE` | DHI Node runtime tag | Optional mirror override (build only) |

## Environment variables (non-Docker)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4780` | API/UI port |
| `HOST` | `127.0.0.1` | Bind address |
| `DCTAGGER_DATA_DIR` | `./.dctagger` | Settings/session/cache directory |
| `DCTAGGER_ROOT_FOLDER` | — | Initial library path when settings are empty |
| `DCTAGGER_DESTINATION_FOLDER` | — | Initial destination path when settings are empty |

In Docker these are supplied by `docker-compose.yml` (`/data`, `/music`, `/output`).

## Commands

```sh
npm run dev              # API (:4780) + Vite UI (:5173)
npm run build            # typecheck + UI build + bundled server
npm start                # build, then serve on :4780
npm run start:prod       # serve an existing build
npm run typecheck        # tsc --noEmit
npm run lint:boundaries  # dependency-cruiser deep-module rules
npm test                 # vitest
npm run check            # typecheck + boundaries + tests
```

## Project structure

```text
src/
  packages/
    discogs/        Discogs client (rate limits, cache, release/track mapping)
    deezer/         Deezer manual lookup + genre fallback
    musicbrainz/    MusicBrainz genre fallback
    matching/       similarity scoring, confidence, file→track mapping
    library/        scanning, dedupe, tag writing, artwork, path planning
    naming/         pure folder/filename pattern rendering
    model/          shared domain types + genre fallback
    server/         Fastify API, session state, jobs
  web/              React review workspace
  main.ts           server entry point
```

Each package is a deep module: root files are public entry points; subfolders are private.
See [src/packages/README.md](src/packages/README.md).

## API rate limits

- **Discogs**: 60 authenticated requests/minute; DCTagger spaces requests, retries 429s, and
  caches search/release responses for 7 days. Image downloads are capped at 1,000/day and
  cached.
- **Deezer**: ~3 requests/second with 30-day caching; manual lookups + genre fallback.
- **MusicBrainz**: 1 request/second with 30-day caching; only after Discogs and Deezer fail.

## Troubleshooting

- **Blank page**: hard-refresh (`Ctrl/Cmd+Shift+R`). Check `/api/health`. `npm start` and
  Docker serve the UI on `:4780`; the Vite dev UI is `:5173`.
- **Discogs 401**: use the **Personal Access Token** from Settings → Developers, not the
  Consumer Key/Secret or an OAuth token, and paste only the token value. Verify with:

  ```sh
  curl -s -H "Authorization: Discogs token=$TOKEN" \
    -H "User-Agent: DCTagger/0.1 +https://github.com/dctagger/dctagger" \
    https://api.discogs.com/oauth/identity
  ```

- **Tagging failures**: the app removes malformed ID3v2 UFID frames and rolls back failed
  files. Check the album's apply errors; applied albums with errors offer **Retry apply**.
- **Permissions in Docker**: make sure `PUID`/`PGID` own `config`, `cache`, `music`, and
  `output` on the host.

## Notes

- DCTagger binds to `127.0.0.1` by default outside Docker. Expose it deliberately.
- The Discogs token is stored locally with mode `0600` and is never sent to Deezer or
  MusicBrainz.
- No audio is downloaded from any metadata provider. Deezer/MusicBrainz lookups send only
  artist/title text.

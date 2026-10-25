# dctagger

A local Discogs music tagger (API + React UI).

## Commands

```sh
npm run dev              # API (:4780) + Vite UI (:5173)
npm run build            # typecheck + build UI + bundled server
npm start                # build, then serve API + UI on :4780
npm run start:prod       # serve existing build on :4780
npm run typecheck        # tsc --noEmit
npm run lint:boundaries  # dependency-cruiser
npm test                 # vitest
npm run check            # typecheck + boundaries + tests
```

Docker: copy `example.env` to `.env`, adjust mounts (`config`, `cache`, `music`, `output`) and PUID/PGID, then `docker compose up -d --build`. The image uses Docker Hardened Images (`dhi.io/node`), so run `docker login dhi.io` first.

Packages are deep modules: see [src/packages/README.md](./src/packages/README.md) before adding or importing one.

# Packages

Every package here is a **deep module**: a lot of behaviour behind a small
interface. The interface is the package's **entry points** — the files at the
package root. Everything in its subfolders is private.

```
src/packages/
  <name>/
    index.ts        ← entry point (public)
    client.ts       ← another entry point, if the package needs one (public)
    lib/            ← implementation (private)
    tests/          ← tests and fixtures (private)
```

## Copy-me

```ts
// src/packages/<name>/index.ts
import { doWork } from "./lib/impl";

export function publicThing(input: string): string {
  return doWork(input);
}
```

```ts
// src/packages/<name>/tests/<name>.test.ts
import { publicThing } from "../index";

publicThing("hello");
```

## The rules

**Import only through a package's entry points (its root files).** Code outside
a package — app code or another package — may import `src/packages/<name>/index.ts`
or any other root file, but never anything inside `lib/` or another subfolder.

**A package's own files import each other freely.** Inside a package, `index.ts`
and `lib/**` can reach each other without ceremony. That freedom stops at the
package boundary: other packages are reachable only through their entry points.

**Tests go through the entry points too.** Files under `<pkg>/tests/` may import
any package's entry points and their own `tests/` fixtures, but never any
package's internals — not even their own. Integration tests across packages are
fine; deep imports are not.

**No dependency cycles.** At all.

**Expose several small entry points, not a barrel.** A package's public surface
is every file at its root, so add `client.ts`, `server.ts`, etc. when a package
has genuinely distinct faces. Do not create an `index.ts` that re-exports a
whole subtree — that turns the entry point into a leak of the implementation and
defeats the point of a deep module.

## Running the check

```sh
npm run lint:boundaries
```

It also runs as part of `npm run check` (typecheck + boundaries + tests). The
configuration lives in `.dependency-cruiser.cjs` at the repo root.

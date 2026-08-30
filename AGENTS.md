# Notes for agents working in this repository

## Ground rules

- The product plan is `PLAN-TASK-GNOME.md`. It is a **product** document, kept
  as written. Do not edit it to match the code; if they disagree, say so.
- `packages/domain` must never import from GNOME (`gi://`, `resource:///`).
  That is what keeps it unit-testable and reusable by the future vault clients.
- The UI must never touch the filesystem. Everything goes
  `ui → application/task-service → TaskRepository → infrastructure/storage`.
- Do not invent cryptography. The vault milestone starts with a written format
  and standard primitives, not code.

## Before claiming something works

`pnpm check` (typecheck + lint + test) is necessary but **not sufficient** for
anything touching the shell. GJS-side mistakes — a wrong resource path, a leaked
signal, a menu that closes on click — typecheck cleanly and fail at runtime.

Two ways to verify without a shell restart:

1. `gjs -m dist/extension.js` parse-checks the bundle. It will stop at the first
   `resource:///` import, which is expected outside the shell; a _syntax_ error
   looks different and is a real failure.
2. Anything that needs only Gio/GLib (storage, for instance) can be bundled with
   esbuild and run under plain `gjs`.

Beyond that, ask the user to reload the shell. Do not restart GNOME Shell
yourself — it is their live desktop session. `./install.sh` stops at printing
the reload instructions for the same reason; keep it that way.

## Conventions

- Relative imports use `.ts` extensions. See `docs/development.md` for why.
- Domain operations return the _same instance_ when nothing changed; callers use
  `===` to skip a repaint and a disk write. Preserve that property.
- Timestamps are UTC ISO-8601. The data file is meant to travel between devices.
- New persisted fields go on the entity _and_ into `parseTask` with a safe
  default, so old files keep loading.
- `extension/metadata.json` never gets a `version` key — extensions.gnome.org
  assigns that integer itself, and a hand-written one is a rejected upload.
  `shell-version` lists only releases the extension was actually run on.
  `docs/release.md` has the rest of the submission rules.
- `./install.sh` is the one-command path (checks, build, install, enable) and is
  a wrapper over `scripts/*.mjs`, not a second build system. The UUID and every
  install path live in `scripts/paths.mjs`; the shell script asks node for them
  rather than repeating the string.

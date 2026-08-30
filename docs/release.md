# Releasing to extensions.gnome.org

## Before you pack

1. Bump `version-name` in `extension/metadata.json`. It is the string EGO shows
   on the listing page; keep it plain (`0.2.0`, not `0.2.0-dev`).
2. `pnpm check` — typecheck, lint, domain tests.
3. Reload the shell and use it. `pnpm check` cannot see a leaked signal, a menu
   that closes on click or a wrong resource path; only the running shell can.

## Pack

```bash
pnpm pack:ego
```

Builds, then wraps `gnome-extensions pack` and prints the archive listing.
`scripts/pack.mjs` fails rather than producing a surprise: the contents are
compared against an explicit list, so a new asset has to be added there
deliberately, and a stray file cannot slip into a submission.

The result is `gnome-task@monchi789.github.com.shell-extension.zip` in the repo
root (git-ignored), around 35 kB.

## Upload

<https://extensions.gnome.org/upload/> — needs a logged-in EGO account. Then the
submission sits in a review queue; a human reads the code in the ZIP.

## Two traps worth remembering

**EGO owns the `version` field.** It assigns the integer itself on every
upload. A `version` key written by hand in `metadata.json` is a rejection.
`version-name` is ours; `version` is theirs.

**`shell-version` lists what was actually tested.** It is currently `["48"]`,
because that is the only shell this has run on. Adding `"49"` or `"50"` means
running it there first — a nested session is enough:

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

Widening the list later is just another upload of the same code with new
metadata; shipping a version that was never started is what earns bad reviews.

## What the reviewers check, and where we stand

The [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
in short, with the answer for this extension:

| Rule                                                 | Here                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| Nothing created before `enable()`                    | `extension.ts` builds everything in `enable()`                      |
| Every source and signal removed in `disable()`       | See the teardown chain in `docs/development.md`                     |
| No Gtk/Adw in the shell process                      | `extension.js` imports Clutter/Gio/GLib/GObject/Pango/St only       |
| No St/Clutter/Meta/Shell in prefs                    | `prefs.js` imports Adw/Gio/GLib/Gtk only                            |
| No minified or obfuscated code                       | esbuild with `minify: false`; each file carries a provenance header |
| No deprecated `imports.*`, ByteArray, Lang, Mainloop | ESM throughout                                                      |
| No excessive logging                                 | `console.warn`/`console.error` on real failures; no `console.log`   |
| Schema under `org.gnome.shell.extensions`            | `org.gnome.shell.extensions.gnome-task`                             |
| Nothing unnecessary in the ZIP                       | Enforced by `scripts/pack.mjs`                                      |
| GPL-2.0-or-later or compatible                       | GPL-3.0-or-later, `LICENSE` is in the archive                       |

The one thing a reviewer may reasonably ask about: `JsonTaskRepository.saveSync()`
blocks the compositor for a single write. It runs only from
`TaskService.destroy()`, where the async path would be cancelled along with the
extension and the last edit would be lost. The comment above it says so.

Reviewers also reject submissions that look machine-generated rather than
authored — the person uploading has to be able to explain the code.

## The schema is not compiled in the archive

`pnpm build` writes `dist/schemas/gschemas.compiled` because the local install
is a symlink to `dist/` and nothing else would compile it. The archive
deliberately ships only the `.gschema.xml`: `extractExtensionArchive()` in the
shell's `ui/extensionDownloader.js` runs `glib-compile-schemas --strict` on
what it extracts, so the binary would be dead weight in the upload.

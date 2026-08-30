# Development

## Environment

| Component            | Version this was built against  |
| -------------------- | ------------------------------- |
| GNOME Shell          | 48.7                            |
| GJS                  | 1.82.3 (SpiderMonkey 115)       |
| Node                 | 24.19 (20+ is enough)           |
| pnpm                 | 11.20                           |
| glib-compile-schemas | any; `libglib2.0-bin` on Debian |

`glib-compile-schemas` is a build dependency, not an optional extra: the build
compiles the GSettings schema, and without `gschemas.compiled` the shell aborts
in `getSettings()` and the extension fails to load with a message that does not
name the real cause. `./install.sh` checks for it before it starts.

## The loop

Once, from a clone:

```bash
./install.sh
```

That is dependencies, build, symlink and enable in one step, with the
prerequisite checks. After that the loop is:

```bash
pnpm build && pnpm install:ext
```

Then reload the shell:

- **X11** — `Alt+F2`, type `r`, Enter. Windows survive; it takes about a second.
- **Wayland** — the shell cannot be restarted in place. Log out and back in, or
  develop in a nested session:
    ```bash
    dbus-run-session -- gnome-shell --nested --wayland
    ```

Check `echo $XDG_SESSION_TYPE` if you are unsure which you are on.

`pnpm install:ext` creates a **symlink** from the extensions directory to
`dist/`, so after the first install only `pnpm build` plus a reload is needed.
Use `node scripts/install.mjs --copy` for a real directory instead (for
packaging, or to hand the extension to someone else) — `./install.sh --copy`
does the same from the top.

## Uninstalling

```bash
pnpm uninstall:ext        # or: ./install.sh --uninstall
```

Disables the extension and removes the install path, symlink or directory. It
never touches `~/.local/share/gnome-task/tasks.json`; `scripts/uninstall.mjs`
prints that path rather than acting on it.

## Watching logs

The shell swallows extension errors unless you look for them:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Preferences run in a **separate process**, so its errors go elsewhere:

```bash
journalctl -f -o cat /usr/bin/gjs
gnome-extensions prefs gnome-task@monchi789.github.com
```

## Checks

```bash
pnpm check      # typecheck + lint + test
pnpm test       # domain unit tests (node --test, no GNOME needed)
pnpm typecheck
pnpm lint
```

## How the build works, and why

GJS resolves neither `node_modules` nor bare specifiers. `import {Task} from
'@gnome-task/domain'` would be a runtime error inside the shell, so plain `tsc`
output is not loadable. `scripts/build.mjs` runs esbuild instead: it inlines the
workspace package and leaves untouched the only two specifier families GJS
understands.

```text
gi://Gio                                -> typelib, resolved by GJS
resource:///org/gnome/shell/ui/main.js  -> shipped inside gnome-shell
./task-item.js                          -> relative, emitted by the bundler
```

`tsc` is used only for type-checking (`--noEmit`).

Source files import each other with **`.ts` extensions**. esbuild rewrites them,
`tsc` accepts them via `allowImportingTsExtensions`, and Node's native type
stripping runs the domain tests without a loader. A `.js` specifier would break
that last one.

`extension.js` and `prefs.js` are separate entry points because the shell loads
them in different processes: the first inside the compositor, the second as a
standalone GTK application.

## Gotchas worth knowing

**The prefs resource path is not the shell one.** Preferences import from
`resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` — capital `S`,
different path — not from `.../org/gnome/shell/extensions/prefs.js`. The wrong
one fails only at runtime, when the prefs window is opened.

**Duplicate `@girs` types.** The `@girs` packages pin _exact_ versions of the
core GLib stack and disagree with each other: `@girs/st-16` wants one line,
`@girs/gtk-4.0` and `@girs/adw-1` another. Without intervention pnpm installs
six copies of `@girs/gio-2.0` and TypeScript treats them as unrelated types, so
a `Gio.Icon` from one cannot be passed where another is expected. The
`overrides` block in `pnpm-workspace.yaml` pins everything to the St/Clutter
line. If a type error mentions two paths under `node_modules/.pnpm` that differ
only by version, this is why.

**Menu items that close the popup.** `PopupBaseMenuItem` installs a
`ClickAction` that emits `activate`, which makes the shell close the menu.
Rows built with `{activate: false}` skip it, which is why ticking a checkbox
leaves the popup open. The shell then styles those rows as inactive, and
`stylesheet.css` undoes the dimming.

**Promisified I/O.** Modern GJS auto-promisifies most `*_async` methods, and the
`@girs` types have matching overloads. `replace_contents_bytes_async` is the
exception — its finish function is `replace_contents_finish`, which breaks the
naming rule — so it is promisified by hand in
`extension/src/infrastructure/storage/gio-async.ts`. That file holds the only
cast of its kind; do not scatter more.

**GTK dialogs are not promisified at all.** The auto-promisification only covers
names ending in `_async`, and `Gtk.FileDialog.open`/`save` and
`Adw.AlertDialog.choose` do not. `await dialog.save(window, null)` throws

```text
method Gtk.FileDialog.save: At least 3 arguments required, but only 2 passed
```

before anything is shown — while the `@girs` types promise a `Promise<Gio.File>`
either way, so it typechecks cleanly and fails only at runtime, in the _prefs_
process where nobody is watching the log. `extension/src/infrastructure/prefs/
gtk-async.ts` promisifies them once; import it before opening a dialog.

**Dragging inside a popup.** `ui/dnd.js` is built for the overview: it reparents
the dragged actor into `Main.uiGroup`, which fights the modal grab a popup menu
holds. `extension/src/ui/drag.ts` does it the other way — it follows the press
through a `captured-event` handler on `global.stage`, reparents nothing, and
draws the drop position by adding a style class to a row. The grip is a plain
reactive `St.Icon` on purpose: an `St.Button` would swallow the press. That
stage handler is the single most dangerous signal in the codebase — if it
outlives a drag, every event in the session goes through it, so it is
disconnected on drop, on Escape, on every re-render and on destroy.

**`disable()` runs more often than you think.** The shell calls it for the lock
screen too. It must destroy the indicator, disconnect every signal and stop
every timer, or you get duplicate indicators and a leaked extension.

## Testing storage without restarting the shell

`JsonTaskRepository` only needs Gio and GLib, not the shell, so it can be
exercised under plain `gjs`. Bundle it with esbuild and run it directly — that
covers atomic writes, the backup file and corruption recovery without touching
your desktop session.

## Layout

```text
packages/domain/     pure TypeScript: entities, collections, board,
                     view-order arithmetic, snapshot format
extension/src/
  application/       TaskService — the only object the UI talks to
  infrastructure/    Gio-backed storage, plus the prefs-side promisify
  ui/                panel button, list, rows, drag controller
scripts/             build, install and uninstall
install.sh           the one-command path: checks, build, install, enable
```

`Board` is the aggregate that holds the groups and the tasks together; anything
that touches both (moving a task between groups, deleting a group without
deleting its tasks, building the sections the popup draws) belongs there rather
than in a widget.

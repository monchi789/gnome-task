# GNOME Task

Local-first task management from the GNOME top bar.

Create, complete and edit tasks without leaving the panel, and sort them into
coloured groups you can fold away and reorder by dragging. Everything is stored
on your machine as plain JSON; there is no account, no server and no network
access. An encrypted vault for secrets is planned — see the roadmap.

```text
Panel:   [icon 3]                          ← pending count, hidden at zero

Popup:   ┌─────────────────────────┐
         │ ☐ Buy bread         🗑  │   ← ungrouped tasks (the inbox)
         │ ▾ ● Work         2  + 🗑 │   ← group: fold, colour, count
         │ ┃ ☐ Finish the API  🗑  │
         │ ┃ ☑ Deploy VPS      🗑  │   ← completed sink to the bottom
         │ ▸ ● Personal     1  + 🗑 │   ← folded
         ├─────────────────────────┤
         │ + New task…             │   ← focused when the popup opens
         │ New group…              │
         ├─────────────────────────┤
         │ Clear completed         │
         │ Preferences             │
         └─────────────────────────┘
```

## What you can do

**Tasks.** Type in the row at the bottom and press Enter; the caret stays put,
so several tasks can be typed in a row. Click the checkbox to complete one —
the popup stays open — the title to rename it inline, the bin to delete it.
While renaming, Enter or clicking elsewhere saves, `Esc` discards; an empty
title is ignored rather than treated as a delete. Completed tasks sink to the
bottom of their section and can be hidden entirely from Preferences, which
never deletes them. `Clear completed` does.

**Groups.** `New group…` names one. On its header: the arrow folds it, the
coloured dot opens a palette of eight colours, the title renames it, `+` opens
a new-task row inside that group, and the bin deletes the group — its tasks are
not deleted, they go back to the ungrouped inbox. The number on the header is
how many tasks in that group are still pending, which is also what the folded
header keeps showing. A group's colour appears as a stripe down the left edge
of its tasks, and whether it is folded is stored with your data, so it arrives
folded the way you left it on another machine.

**Reordering.** Hover a row and drag the grip on its left: tasks move inside
their group or into another one, a group moves with everything in it, and the
list scrolls by itself when the pointer nears its edge. `Ctrl+Up` and
`Ctrl+Down` do the same from the keyboard on a focused row, and `Esc` cancels a
drag in progress.

Groups are the `Project` of the product plan; the stored field is still called
`projectId`.

**Status:** `0.1.0-dev` — the TODO milestone (M0 + phase 2 of the product plan),
plus groups from `0.2`.

## Preferences

Open them from the popup, or with
`gnome-extensions prefs gnome-task@monchi789.github.com`.

| Setting               | What it does                                            |
| --------------------- | ------------------------------------------------------- |
| Show pending count    | The number next to the panel icon. It hides at zero.    |
| Show completed tasks  | Keep finished tasks visible at the bottom of a section. |
| Rows before scrolling | How tall the popup grows before it scrolls (5–100).     |
| Task file             | Where your tasks are stored. See below.                 |

## Requirements

- GNOME Shell 48
- Node 20+ and pnpm — to build from source
- `glib-compile-schemas`, to compile the settings schema:
  `libglib2.0-bin` on Debian/Ubuntu, `glib2-devel` on Fedora

## Install

The extension is not on extensions.gnome.org yet; for now it is built from
source. See [`docs/release.md`](docs/release.md) for how a release is packaged
and submitted.

From a clone of this repository:

```bash
./install.sh
```

It checks the prerequisites above, installs dependencies, builds, links the
result into `~/.local/share/gnome-shell/extensions/` and enables the extension.
Then restart GNOME Shell — on X11 press `Alt+F2`, type `r`, press Enter; on
Wayland log out and back in.

Useful flags: `--copy` installs a real directory instead of a symlink (for
handing the extension to someone else), `--skip-deps` skips `pnpm install`,
`--no-enable` installs without enabling, and `-h` lists them all.

The same thing by hand, if you would rather see the steps:

```bash
pnpm install
pnpm build
pnpm install:ext          # symlinks dist/ into ~/.local/share/gnome-shell/extensions
gnome-extensions enable gnome-task@monchi789.github.com
```

On a first install `gnome-extensions enable` reports the extension as
non-existent — the running shell has not scanned the new directory yet — while
still marking it as enabled. It starts on the reload; there is nothing to
re-run.

## Uninstall

```bash
./install.sh --uninstall   # or: pnpm uninstall:ext
```

Your tasks file is left where it is; reinstalling picks it up again exactly as
it was.

## Where your data lives

```text
~/.local/share/gnome-task/tasks.json
```

Another location can be chosen in Preferences → Storage. Choosing an existing
file loads it as it is; creating a new one offers to copy your current tasks
across. Nothing is ever moved or deleted behind your back.

Edits are held for a moment (400 ms) before being written, so a burst of typing
is one write rather than ten, and anything still pending is flushed
synchronously when the extension is disabled. Writes are atomic and the
previous version is kept alongside as `tasks.json~`. If the file is ever
unreadable, it is renamed to `tasks.json.corrupt-<stamp>` rather than
overwritten, and the extension starts with an empty list. Timestamps are UTC,
because the file is meant to travel between machines.

The file is at schema version 2, which added groups. Version 1 files are read
and upgraded on the first save. Going back to an older build after that is the
one thing to avoid: it does not understand version 2 and will move the file
aside as unreadable — renamed, never deleted.

## Architecture

```text
ui/  ──▶  application/  ──▶  domain (packages/domain)
                    │
                    ▼
            infrastructure/storage
```

The UI never touches the filesystem, and `packages/domain` never imports
anything from GNOME. That separation is what lets the storage layer be swapped
for the encrypted vault later without rewriting the interface, and it is why
the domain can be unit-tested with plain `node --test`.

## Development

See [`docs/development.md`](docs/development.md) for the edit-build-reload loop,
logs and troubleshooting.

## Roadmap

The full product plan lives in [`PLAN-TASK-GNOME.md`](PLAN-TASK-GNOME.md).
This release covers `0.1` plus the grouping half of `0.2`; next up are tags,
priorities and due dates, then the encrypted, portable vault. Priority and due
date already exist in the stored format — every task carries them — but nothing
in the popup reads or sets them yet.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

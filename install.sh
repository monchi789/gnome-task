#!/usr/bin/env bash
#
# One command from a fresh clone to a working extension.
#
# This is a wrapper, not a second build system: everything it does is
# `scripts/build.mjs` and `scripts/install.mjs` in the right order, with the
# prerequisite checks that turn their failures into something actionable.
# It deliberately stops short of restarting GNOME Shell — that is the user's
# live desktop session — and prints the reload instructions instead.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

MIN_NODE_MAJOR=20

copy_mode=false
enable_ext=true
skip_deps=false
uninstall=false

usage() {
    cat <<'USAGE'
Usage: ./install.sh [options]

Builds GNOME Task and installs it into your GNOME Shell extensions directory.

Options:
  --copy        Install a real directory instead of a symlink to dist/.
                Use this to hand the extension to someone else; the default
                symlink is what makes the edit-build-reload loop work.
  --no-enable   Install but do not run `gnome-extensions enable`.
  --skip-deps   Skip `pnpm install` (dependencies are already there).
  --uninstall   Disable and remove the installed extension. Your tasks file
                is never touched.
  -h, --help    Show this message.
USAGE
}

for arg in "$@"; do
    case "$arg" in
        --copy) copy_mode=true ;;
        --no-enable) enable_ext=false ;;
        --skip-deps) skip_deps=true ;;
        --uninstall) uninstall=true ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            echo "unknown option: $arg" >&2
            usage >&2
            exit 2
            ;;
    esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$1" >&2; }
die() {
    printf '\033[31merror:\033[0m %s\n' "$1" >&2
    exit 1
}

# The UUID lives in scripts/paths.mjs and is asked for rather than repeated:
# it already appears in metadata.json and the gschema path, and a fourth copy
# in a shell string is the one nobody remembers to change.
uuid() {
    node --input-type=module -e 'import {UUID} from "./scripts/paths.mjs"; console.log(UUID);'
}

if $uninstall; then
    exec node scripts/uninstall.mjs
fi

step 'Checking prerequisites'

command -v node >/dev/null || die 'node is not installed — GNOME Task needs Node '"$MIN_NODE_MAJOR"'+.'
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge "$MIN_NODE_MAJOR" ] ||
    die "node $(node -v) is too old — GNOME Task needs Node ${MIN_NODE_MAJOR}+."
note "node $(node -v)"

command -v pnpm >/dev/null ||
    die 'pnpm is not installed — run `corepack enable pnpm`, or see https://pnpm.io/installation'
note "pnpm $(pnpm --version)"

# The build compiles the GSettings schema, and without a compiled schema the
# shell aborts in getSettings() with a message that does not name the cause.
command -v glib-compile-schemas >/dev/null ||
    die 'glib-compile-schemas is missing — install libglib2.0-bin (Debian/Ubuntu) or glib2-devel (Fedora).'
note 'glib-compile-schemas found'

command -v gnome-extensions >/dev/null ||
    die 'gnome-extensions is missing — it ships with gnome-shell. Is this a GNOME session?'

# A version mismatch is a warning, never a stop: the extension may well work on
# a newer shell, and the user is the one who gets to find out.
supported="$(node -p 'require("./extension/metadata.json")["shell-version"].join(", ")')"
if shell_version="$(gnome-shell --version 2>/dev/null)"; then
    shell_major="$(printf '%s' "$shell_version" | grep -oE '[0-9]+' | head -1)"
    note "GNOME Shell ${shell_version#GNOME Shell }"
    case " $supported " in
        *" $shell_major "*) ;;
        *) warn "this extension declares support for GNOME Shell $supported; yours is $shell_major." ;;
    esac
fi

if $skip_deps; then
    step 'Skipping dependencies (--skip-deps)'
else
    step 'Installing dependencies'
    pnpm install --frozen-lockfile
fi

step 'Building'
pnpm build

step 'Installing the extension'
if $copy_mode; then
    node scripts/install.mjs --copy --quiet
else
    node scripts/install.mjs --quiet
fi

UUID="$(uuid)"

if $enable_ext; then
    step 'Enabling'
    # A shell that has not scanned the new directory yet reports the extension
    # as non-existent and exits non-zero — after having added it to
    # `enabled-extensions` all the same, which is all that is needed: it starts
    # on the next reload. Checking the key is what tells those two cases apart.
    if gnome-extensions enable "$UUID" 2>/dev/null; then
        note "enabled $UUID"
    elif gsettings get org.gnome.shell enabled-extensions 2>/dev/null | grep -q "'$UUID'"; then
        note 'queued — it starts when the shell reloads'
    else
        warn 'could not enable it yet — run this after the reload below:'
        note "gnome-extensions enable $UUID"
    fi
fi

step 'Done — one manual step left'
if [ "${XDG_SESSION_TYPE:-}" = 'wayland' ]; then
    note 'Log out and back in (Wayland cannot restart the shell in place).'
else
    note 'Press Alt+F2, type  r  and hit Enter to restart GNOME Shell.'
fi
note 'Then look for the task icon in the top bar.'
echo
note 'If it does not appear:'
note "  gnome-extensions info $UUID"
note '  journalctl -f -o cat /usr/bin/gnome-shell'

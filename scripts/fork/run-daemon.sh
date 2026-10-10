#!/usr/bin/env bash
# Ground Control's start command for the operator's daemon: run this release's daemon in the
# foreground with the operator's login-shell environment, the way the desktop app does
# (packages/desktop/src/login-shell-env.ts). Without it, agents can't find the provider CLIs
# (claude, codex) or the operator's shell settings. Run from a release directory.
#
#   scripts/fork/run-daemon.sh <paseo-home>
set -euo pipefail
home="$1"
exec "${SHELL:-/bin/zsh}" -ilc 'exec node packages/cli/dist/index.js daemon run --home "$0"' "$home"

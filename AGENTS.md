# AGENTS.md

**Read [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) before doing anything in this
repository.** It is the single source of truth for build instructions, project rules,
hardware notes, and testing steps. This file only records what applies to agents
generally. Claude also has [CLAUDE.md](CLAUDE.md).

## Rules for all agents

- `main` is stable. Never develop on it directly.
- Stay in your own branch namespace:
  - `claude/*` — Claude
  - `codex/*` — Codex
  Do not push to, rebase, or force-push another agent's namespace.
- One topic per branch; open a PR into `main`.
- No AI attribution trailers in commit messages or PR bodies.
- Never commit credentials, Wi-Fi passwords, serial port names, generated build
  files, or local environment files. See the guide's "Things that must never be
  committed" section.

## Hard stop: hardware details

The board model is **not yet decided**. Do not guess or infer the chip variant,
pinout, USB configuration, flash layout, PSRAM settings, or partition table. If a
task requires a value that Section 4 of the guide still lists as `TBD`, stop and ask
the repository owner.

## CI

CI is build-only. Adding flashing, serial, or hardware-in-the-loop steps requires an
explicit instruction from the owner.

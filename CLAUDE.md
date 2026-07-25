# CLAUDE.md

**Read [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) before doing anything in this
repository.** It is the single source of truth for build instructions, project rules,
hardware notes, and testing steps. This file only records what is specific to Claude.

## Claude's working agreement

- Work on `claude/*` branches. Never commit to `main`.
- `codex/*` branches belong to Codex — do not push to, rebase, or force-push them.
- No AI attribution trailers in commit messages or PR bodies.
- Never commit credentials, Wi-Fi passwords, serial port names, build output, or
  local environment files. See the "Things that must never be committed" section of
  the guide.

## Hard stop: hardware details

The board model is **not yet decided**. Do not infer the chip variant, pinout, USB
mode, flash layout, PSRAM configuration, or partition table — not from the repository
name, not from a similar module's datasheet, not from a previous project.

If a task needs one of those values and Section 4 of the guide is still `TBD`, stop
and ask the repository owner.

## CI

CI is build-only. Do not add flashing, serial monitoring, or hardware-in-the-loop
steps without an explicit instruction from the owner.

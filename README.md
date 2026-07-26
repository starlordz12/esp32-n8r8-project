# esp32-n8r8-project

Firmware and deployment workspace for
[RuView](https://github.com/ruvnet/RuView) ESP32-S3 CSI sensor nodes.

> **Status:** Hardware is confirmed as a YD-ESP32-S3 N8R8 development board
> (ESP32-S3-DevKitC-1 compatible). The RuView firmware integration is planned but
> has not yet been imported, so there is not a tracked firmware target to build.

## Start here

All shared documentation lives in **[docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)**:

- Build instructions
- Project rules (branching, commits, what must never be committed)
- Confirmed hardware and pin constraints
- RuView build and Raspberry Pi deployment plan
- Testing steps

`CLAUDE.md` and `AGENTS.md` are thin pointers to that guide so every contributor —
human or agent — works from the same source.

## Branches

| Branch     | Purpose                                    |
| ---------- | ------------------------------------------ |
| `main`     | Stable. No direct development.             |
| `claude/*` | Claude's working branches.                 |
| `codex/*`  | Reserved for Codex.                        |

## CI

`.github/workflows/build.yml` is build-only. No flashing, no hardware tests.

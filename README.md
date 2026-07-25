# esp32-n8r8-project

Firmware project for an ESP32 N8R8-class module (8 MB flash / 8 MB PSRAM class part).

> **Status: scaffold only.** No board model has been committed to yet, so this
> repository deliberately contains no pinout, no USB configuration, no flash layout,
> and no PSRAM settings. Those are filled in by the repository owner.

## Start here

All shared documentation lives in **[docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)**:

- Build instructions
- Project rules (branching, commits, what must never be committed)
- Hardware notes
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

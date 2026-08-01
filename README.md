# esp32-n8r8-project

Firmware and deployment workspace for
[RuView](https://github.com/ruvnet/RuView) ESP32-S3 CSI sensor nodes.

> **Status:** Hardware is confirmed as a YD-ESP32-S3 N8R8 development board
> (ESP32-S3-DevKitC-1 compatible). RuView is pinned by commit and builds with
> ESP-IDF v5.4 using its display-less DevKitC configuration.

## Start here

All shared documentation lives in **[docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)**:

- Build instructions
- Project rules (branching, commits, what must never be committed)
- Confirmed hardware and pin constraints
- RuView build and Raspberry Pi deployment plan
- Testing steps

`CLAUDE.md` and `AGENTS.md` are thin pointers to that guide so every contributor —
human or agent — works from the same source.

## Build RuView

Docker Desktop and Git are the only host dependencies. The scripts fetch only the
pinned upstream firmware subtree; upstream source and generated binaries remain
ignored by Git.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Sync-RuView.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-RuView.ps1
```

Successful builds are packaged under `artifacts/` with SHA-256 checksums. GitHub
Actions runs the same build and publishes the package as a workflow artifact.

## Branches

| Branch     | Purpose                                    |
| ---------- | ------------------------------------------ |
| `main`     | Stable. No direct development.             |
| `claude/*` | Claude's working branches.                 |
| `codex/*`  | Reserved for Codex.                        |

## CI

`.github/workflows/build.yml` is build-only. No flashing, no hardware tests.

## Portable demo dashboard

The offline-friendly visitor and operator interface lives in
`demo/dashboard/`. Its local adapter now converts the pinned RuView health and
sensing responses into a small validated snapshot. The interface switches to
live mode only for a complete, recent ESP32 update; every other state remains
clearly labeled as preview, simulation, waiting, offline, or unavailable.

```powershell
cd demo\dashboard
npm.cmd ci
npm.cmd run dev
```

Copy `demo/dashboard/.dev.vars.example` to the ignored `.dev.vars` file to set
the local RuView origin and, when enabled, its API token. Keep all real network
values and credentials outside Git.

## Raspberry Pi one-node deployment

The local Pi stack pins the multi-architecture RuView server image by digest,
builds a minimal unprivileged dashboard container, requires API authentication,
and keeps the raw RuView HTTP/WebSocket interfaces on loopback by default. Start
with the complete **[one-node bring-up runbook](docs/PI_ONE_NODE_BRINGUP.md)**.

The firmware package now includes a machine-readable flash manifest. Use the
validation, flash, and secure provisioning helpers only from the development
machine; hardware operations remain manual and are never run in CI.

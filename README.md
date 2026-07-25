# esp32-n8r8-project

Wi-Fi CSI sensing project targeting YEJMKJ ESP32-S3-DevKitC-1-N8R8-compatible
nodes and a Raspberry Pi 5 aggregation base station.

> **Status:** software foundations and deployment documentation are in progress.
> Real sensing and through-wall results require physical hardware validation and
> labeled experiments.

## Start here

- **[Project guide](docs/PROJECT_GUIDE.md)** — shared build, hardware, testing,
  and collaboration rules
- **[Raspberry Pi 5 base-station setup](docs/PI_BASE_STATION.md)** — complete
  headless OS, NVMe, Docker, RuView, networking, and verification procedure

`CLAUDE.md` and `AGENTS.md` are thin pointers to the project guide so every
contributor—human or agent—works from the same source.

## Deployment files

The production-oriented Raspberry Pi Compose configuration is under
[`deploy/pi`](deploy/pi). It receives ESP32 CSI on UDP `5005` and serves the
local RuView dashboard on TCP `3000`.

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Stable. No direct development. |
| `claude/*` | Claude's working branches. |
| `codex/*` | Codex working branches. |

## CI

`.github/workflows/build.yml` is build-only. It never flashes devices or runs
hardware-in-the-loop steps.



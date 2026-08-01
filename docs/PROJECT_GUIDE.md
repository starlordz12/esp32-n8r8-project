# Project Guide

Single source of truth for this repository. `CLAUDE.md` and `AGENTS.md` both point
here — update this file, not the agent files, when the rules change.

---

## 1. Status

The target hardware and software stack are confirmed:

- YD-ESP32-S3 Core Board, N8R8 variant
- ESP32-S3-DevKitC-1-compatible, display-less carrier
- ESP32-S3 with 8 MB flash and 8 MB octal PSRAM
- RuView ESP32 CSI node firmware
- ESP-IDF v5.4, built with RuView's display-less DevKitC configuration overlay

The build integration pins RuView commit
`f783df234eec22929b88e256422cbfc50579196b` in `ruview.lock.json`. The
`scripts/Sync-RuView.ps1` helper sparsely fetches only the firmware subtree into
the ignored `.deps/` directory, so builds are reproducible without copying
upstream source into this repository.

A byte-for-byte factory flash backup was captured and verified locally before any
firmware changes. It is a recovery artifact and must remain outside Git.

---

## 2. Project rules

### Branching

| Branch      | Purpose                                                |
| ----------- | ------------------------------------------------------ |
| `main`      | Stable branch. Protected by convention — no direct dev. |
| `claude/*`  | Claude's working branches.                              |
| `codex/*`   | Reserved for Codex. Claude must not push or force-push here. |

- After the initial scaffold, **never commit directly to `main`.** Branch, commit,
  push, open a PR, merge.
- One topic per branch. Name it for the work: `claude/add-uart-driver`,
  `codex/refactor-logging`.
- Rebase or merge `main` into your branch before opening a PR; do not rewrite
  history on a branch someone else may have pulled.
- Delete branches after merge.

### Commits

- Present-tense, imperative subject lines (`Add build workflow`, not `Added...`).
- No AI attribution trailers (`Co-Authored-By:`, `Generated with ...`). The
  repository owner is the sole author of record.
- Keep commits scoped — one logical change each.

### Things that must never be committed

Enforced by `.gitignore`, but the rule is the rule regardless of tooling:

- Credentials, API keys, tokens, certificates, private keys.
- Wi-Fi SSIDs and passwords. For RuView, provision them directly into NVS. If
  future source needs a local credentials file, keep it ignored and commit only a
  `*.example` template with placeholder values.
- Serial port names (`COM7`, `/dev/ttyUSB0`, `/dev/cu.usbmodem*`). These are
  per-machine — keep them in ignored local config, never in tracked source or docs.
- Generated build output: `.pio/`, `build/`, `sdkconfig`, `sdkconfig.old`,
  `managed_components/`, `*.bin`, `*.elf`, `*.map`.
- Local environment files: `.env`, `.env.*`, `.vscode/`, `.idea/`,
  `*.local.*`, virtualenvs.

If a secret is committed by accident: rotate it first, then scrub history. Rotation
comes first — assume anything pushed is compromised.

### Scope discipline

- Do not guess hardware values. If a task requires a pin number, flash size, PSRAM
  mode, USB mode, or partition offset that is not written in Section 4, stop and ask.
- Do not add flashing, monitoring, or hardware-in-the-loop steps to CI. CI is
  build-only until the owner says otherwise.

---

## 3. Build instructions

### Toolchain

- Toolchain and framework: ESP-IDF v5.4
- Target: `esp32s3`
- Upstream firmware: `ruvnet/RuView`, `firmware/esp32-csi-node`
- Board configuration: `sdkconfig.defaults` plus
  `sdkconfig.defaults.devkitc`
- Host build method on Windows: Docker using `espressif/idf:v5.4`
- Flash/provision tooling: Python 3.10+ and esptool 5.x

Do not substitute the Arduino framework or PlatformIO defaults. RuView uses native
ESP-IDF features including Wi-Fi CSI, NVS provisioning, PSRAM, Kconfig, and its
custom OTA partition table.

### Local build

Install and start Docker Desktop, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-RuView.ps1
```

The script verifies the lock, fetches the exact upstream commit, performs a clean
Docker build, checks the required flash outputs, and creates SHA-256 checksums
under the ignored `artifacts/` directory.

The display-less overlay is required. Current RuView firmware can falsely detect a
display on DevKitC-style boards without it, preventing the required CSI capture
mode and producing zero packets.

The expected flash inputs are the RuView bootloader, partition table, initial OTA
data, and application image. Flash offsets are recorded in Section 4. Never commit
these generated binaries.

### Local-only configuration

Anything machine-specific (serial port, upload speed, monitor settings) goes in an
untracked local file — `platformio_local.ini`, `.env`, or an IDE setting — never in
the tracked build config.

Wi-Fi credentials, the Raspberry Pi aggregator address, mesh keys, and per-board
node IDs must be written with RuView's `provision.py` into NVS. They must not be
placed in `sdkconfig.defaults`, source files, captured logs, or Git.

### Deployment sequence

1. Synchronize the pinned RuView firmware source.
2. Build the ESP32-S3 firmware with ESP-IDF v5.4 and the display-less DevKitC
   overlay.
3. Prepare a Raspberry Pi 5 as the RuView aggregator, preferably connected to the
   router by Ethernet with a reserved IP address.
4. Flash one ESP32-S3 through its CH343P USB-to-UART port.
5. Provision Wi-Fi, the Pi aggregator IP, and a unique node ID into NVS.
6. Monitor the node at 115200 baud and verify CSI traffic reaches UDP port 5005 on
   the Pi.
7. Repeat for the remaining boards with unique node IDs.
8. Position and calibrate the nodes only after the first end-to-end path is stable.

### Portable demo dashboard

`demo/dashboard/` contains the offline-friendly presentation layer for the
portable Raspberry Pi kit. It separates the simple visitor experience from the
operator readiness view and includes:

- A large room-activity display with plain-language status.
- A three-step guided demonstration.
- A camera-free and microphone-free privacy explanation.
- Node-health and setup checks for the person operating the kit.
- Responsive layouts for a tablet, laptop, or kiosk display.

The dashboard includes a read-only Raspberry Pi adapter that normalizes the
pinned RuView server's `/health` and `/api/v1/sensing/latest` responses. It enters
live mode only when RuView reports a complete, recent ESP32 update with at least
one node. Missing configuration, simulation, no-data, stale/offline, invalid,
timeout, and authorization failures remain explicitly non-live.
Run it locally with Node.js 22.13 or later:

```powershell
cd demo\dashboard
npm.cmd ci
npm.cmd run dev
```

For local adapter configuration, copy `.dev.vars.example` to the ignored
`.dev.vars` file inside `demo/dashboard/`. Set the RuView server origin and the
optional API token only in that local file. The token is consumed server-side and
must never be returned to the browser, logs, source, or Git.

Network names, credentials, Pi addresses, node identities, and room-specific
placement remain outside Git. The dashboard must remain usable on the portable
router network without cloud or internet access.

### Raspberry Pi one-node stack

`deploy/pi/` contains the supported local deployment. The sensing server image
is pinned by manifest digest, forced to the ESP32 input source, and protected by
a required local API token. Its HTTP and WebSocket ports bind to loopback by
default; only dashboard TCP 8080 and ESP32 ingest UDP 5005 are LAN-facing.

Follow [PI_ONE_NODE_BRINGUP.md](PI_ONE_NODE_BRINGUP.md) from a clean Pi 5. Prove
one node with `deploy/pi/verify.sh --expect-live` and complete a stability soak
before adding another node. The server-image lock is separate from the firmware
lock because upstream did not publish an image for the exact firmware commit;
the recorded image commit was reviewed to confirm that no server or Docker files
changed between those commits.

---

## 4. Hardware

The owner confirmed the board from physical inspection and photos. A read-only
esptool probe independently verified the chip and memory configuration.

| Item                   | Value |
| ---------------------- | ----- |
| Board model            | YD-ESP32-S3 Core Board, N8R8; ESP32-S3-DevKitC-1 compatible |
| Chip / variant         | ESP32-S3 QFN56, dual-core 240 MHz, revision v0.2 |
| Flash                  | 8 MB, 3.3 V, quad-capable; RuView uses DIO at 80 MHz |
| PSRAM                  | 8 MB octal PSRAM, 3.3 V |
| USB-to-UART            | USB-C connector labeled `COM`, through WCH CH343P; primary flash and serial connection |
| Native USB             | USB-C connector labeled `USB`, direct to GPIO19 (D-) and GPIO20 (D+); USB OTG/JTAG |
| Bootloader mode        | Automatic UART download; manual fallback is hold BOOT and press RST |
| RuView partition table | Upstream 8 MB OTA layout in `partitions_display.csv` |
| Development power      | Use one USB-C port; do not combine USB and header power without reviewing jumper state |

### RuView flash layout

These values match the partition table and flashing instructions at the RuView
commit pinned in `ruview.lock.json`.

| Artifact / partition | Offset     | Size |
| -------------------- | ---------- | ---- |
| Bootloader           | `0x000000` | Generated by ESP-IDF |
| Partition table      | `0x008000` | Generated by ESP-IDF |
| NVS                  | `0x009000` | `0x006000` |
| Initial OTA data     | `0x00F000` | `0x002000` |
| PHY init             | `0x011000` | `0x001000` |
| OTA application 0    | `0x020000` | `0x200000` |
| OTA application 1    | `0x220000` | `0x200000` |
| SPIFFS               | `0x420000` | `0x1E0000` |

### Pin map

| Function           | Pin(s)          | Notes |
| ------------------ | --------------- | ----- |
| BOOT button        | GPIO0           | Hold during reset for ROM download mode |
| UART0 TX / RX      | GPIO43 / GPIO44 | Connected to CH343P; TX/RX LEDs share these signals |
| Native USB D- / D+ | GPIO19 / GPIO20 | Reserved when native USB is enabled |
| Onboard WS2812 RGB | GPIO48          | Routed through the board's `RGB` solder jumper |
| Internal PSRAM bus | GPIO35/36/37    | Do not use externally on this N8R8 board |

GPIO0, GPIO3, GPIO45, and GPIO46 are strapping pins. Do not assign external
hardware that can force their boot-time levels without a deliberate design review.

### Peripherals

- WCH CH343P USB-to-UART bridge
- WS2812 addressable RGB LED
- Power, UART TX, and UART RX status LEDs
- RST and BOOT buttons
- Two USB-C connectors: USB-to-UART and native USB OTG/JTAG

### References

- [RuView ESP32 CSI node](https://github.com/ruvnet/RuView/tree/main/firmware/esp32-csi-node)
- [RuView display-less DevKitC overlay](https://github.com/ruvnet/RuView/blob/main/firmware/esp32-csi-node/sdkconfig.defaults.devkitc)
- [YD-ESP32-S3 hardware documentation](https://github.com/vcc-gnd/YD-ESP32-S3)
- [Espressif ESP32-S3-DevKitC-1 guide](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html)

---

## 5. Testing

### Continuous integration

`.github/workflows/build.yml` runs on pushes and PRs to `main`, `claude/*`, and
`codex/*`. It is **build-only**:

- Builds the exact RuView commit from `ruview.lock.json` in
  `espressif/idf:v5.4` and uploads the generated package.
- Validates the generated flash manifest, four reviewed offsets, and SHA-256
  hashes before uploading the package.
- Detects the toolchain from files present in the repo.
- Builds with PlatformIO if `platformio.ini` exists.
- Builds with ESP-IDF if `CMakeLists.txt` exists **and** the `IDF_VERSION`
  repository variable is set (the version is a deliberate manual choice, not a guess).
- If neither is present, the job reports "no firmware target configured" and passes.
- Builds and tests the dashboard, then statically validates the Raspberry Pi
  Compose configuration and verification script.

The pinned RuView path does not use the `IDF_VERSION` repository variable; its
container image and display-less DevKitC defaults are declared in the lock and
used by the same script locally and in CI.

No flashing. No serial. No hardware-in-the-loop. Those are added only on the
owner's explicit instruction.

### Local checks before pushing

1. Clean build from a fresh checkout.
2. `git status` clean — no stray build artifacts or local config staged.
3. `git diff --cached` reviewed for secrets, ports, and credentials.

### Hardware testing

Manual, off-CI, and owner-run:

1. Build and flash one node before touching the remaining boards.
2. Confirm the boot log identifies the configured node ID and successful Wi-Fi
   connection.
3. Confirm CSI streaming is active and the Pi receives UDP packets on port 5005.
4. Run a short stability soak before cloning the process to additional nodes.
5. Give every additional node a unique ID and verify it independently.

Flashing, serial monitoring, and hardware-in-the-loop checks must remain outside CI.

# Project Guide

Single source of truth for this repository. `CLAUDE.md` and `AGENTS.md` both point
here — update this file, not the agent files, when the rules change.

---

## 1. Status

The project targets a **YEJMKJ ESP32-S3-DevKitC-1-N8R8-compatible board** from
Amazon listing [B0D93D26HW](https://www.amazon.com/dp/B0D93D26HW). The listing
identifies an ESP32-S3-WROOM-1-N8R8 module, dual USB-C ports, 8 MB flash, and
8 MB PSRAM.

The memory configuration and core pin reservations are documented by Espressif.
Because this is a third-party DevKitC-compatible board, the PCB revision and RGB
LED pin must still be confirmed from the physical boards when they arrive.

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
- Wi-Fi SSIDs and passwords. Use `secrets.h` / `credentials.h` (both ignored) and
  commit a `*.example` template with placeholder values instead.
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

RuView's reference CSI firmware uses ESP-IDF, so this project will use the same
toolchain for firmware compatibility.

- Toolchain and version: ESP-IDF v5.2 initially (matching the upstream reference build)
- Framework: ESP-IDF
- Target: `esp32s3`
- Board class: ESP32-S3-DevKitC-1-N8R8-compatible

### Local build

Once the firmware project files land:

```bash
idf.py set-target esp32s3
idf.py build
```

On Windows, prefer the pinned Espressif Docker image so the local SDK and shell
environment cannot silently change the build. Firmware flashing remains a manual,
owner-run step and is never performed by CI.

### Local-only configuration

Anything machine-specific (serial port, upload speed, monitor settings) goes in an
untracked local file — `platformio_local.ini`, `.env`, or an IDE setting — never in
the tracked build config.

---

## 4. Hardware

The seller listing identifies a YEJMKJ five-pack of DevKitC-compatible boards.
Espressif's official N8R8 configuration is the authority for memory settings;
seller claims about the clone PCB are confirmed during physical bring-up.

| Item                  | Value |
| --------------------- | ----- |
| Board model           | YEJMKJ ESP32-S3-DevKitC-1-N8R8-compatible, Amazon ASIN B0D93D26HW |
| Chip / variant        | ESP32-S3-WROOM-1-N8R8; dual-core Xtensa LX7, target `esp32s3` |
| Flash size            | 8 MB, Quad SPI |
| PSRAM size and mode   | 8 MB, Octal SPI (OPI) |
| USB configuration     | Dual USB-C: USB-to-UART plus native ESP32-S3 USB OTG/Serial-JTAG |
| Bootloader / DFU mode | ROM serial download; hold BOOT (GPIO0) and tap RESET if automatic entry fails; do not assume USB DFU |
| Partition table       | Planned RuView-compatible 8 MB OTA layout: bootloader `0x0`, table `0x8000`, OTA data `0xf000`, app/OTA0 `0x20000` |
| Power input           | USB-C, 5 V + GND pins, or 3.3 V + GND pins; treat the methods as mutually exclusive |

### Pin map

CSI capture uses the integrated Wi-Fi radio and requires no external signal pin.
The following reservations prevent accidental conflicts during expansion.

| Function | Pin | Notes |
| -------- | --- | ----- |
| Boot strap/button | GPIO0 | Avoid forcing low except when entering the ROM downloader |
| Native USB D- | GPIO19 | Reserved when native USB is used |
| Native USB D+ | GPIO20 | Reserved when native USB is used |
| UART0 TX | GPIO43 | USB-to-UART console path |
| UART0 RX | GPIO44 | USB-to-UART console path |
| Flash/PSRAM internal bus | GPIO35-37 | Not available externally on this N8R8 memory configuration |
| Addressable RGB LED | GPIO38 or GPIO48 | Espressif v1.1 uses GPIO38; initial revision uses GPIO48; verify clone on arrival |

### Peripherals

- Integrated 2.4 GHz Wi-Fi and Bluetooth LE radio.
- USB-to-UART bridge and native ESP32-S3 USB interface.
- BOOT and RESET buttons.
- Addressable RGB status LED; exact GPIO is a physical bring-up check.

### Sources

- Seller: [Amazon ASIN B0D93D26HW](https://www.amazon.com/dp/B0D93D26HW)
- [Espressif ESP32-S3-DevKitC-1 hardware guide](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html)
- [RuView ESP32 CSI firmware guide](https://github.com/ruvnet/RuView/tree/main/firmware/esp32-csi-node)

---

## 5. Testing

### Continuous integration

`.github/workflows/build.yml` runs on pushes and PRs to `main`, `claude/*`, and
`codex/*`. It is **build-only**:

- Detects the toolchain from files present in the repo.
- Builds with PlatformIO if `platformio.ini` exists.
- Builds with ESP-IDF if `CMakeLists.txt` exists **and** the `IDF_VERSION`
  repository variable is set (the version is a deliberate manual choice, not a guess).
- If neither is present, the job reports "no firmware target configured" and passes.

No flashing. No serial. No hardware-in-the-loop. Those are added only on the
owner's explicit instruction.

### Local checks before pushing

1. Clean build from a fresh checkout.
2. `git status` clean — no stray build artifacts or local config staged.
3. `git diff --cached` reviewed for secrets, ports, and credentials.

### Hardware testing

Manual, off-CI, and owner-run for now. Procedure to be written once the board is
known and a first firmware image exists.

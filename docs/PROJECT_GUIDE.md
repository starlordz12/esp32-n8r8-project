# Project Guide

Single source of truth for this repository. `CLAUDE.md` and `AGENTS.md` both point
here — update this file, not the agent files, when the rules change.

---

## 1. Status

The project is scaffolded but **not yet configured for a specific board**.

Nothing in this repo assumes a chip variant, pinout, USB mode, flash layout, or
PSRAM configuration. Those values are supplied by the repository owner and are
recorded in [Section 4](#4-hardware) once known.

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

**Not yet selected.** The two candidates are PlatformIO and ESP-IDF; the choice
depends on the board and is made by the owner. The CI workflow already handles
either — see Section 5.

Once chosen, record here:

- Toolchain and version: _TBD_
- Framework (Arduino / ESP-IDF): _TBD_
- Board identifier / target: _TBD_

### Local build

Placeholder — fill in when the toolchain lands.

**If PlatformIO:**

```bash
pip install -U platformio
pio run
```

**If ESP-IDF:**

```bash
idf.py set-target <target>   # target comes from Section 4, do not guess
idf.py build
```

### Local-only configuration

Anything machine-specific (serial port, upload speed, monitor settings) goes in an
untracked local file — `platformio_local.ini`, `.env`, or an IDE setting — never in
the tracked build config.

---

## 4. Hardware

> **Awaiting exact board model from the repository owner.**
> Every field below is intentionally blank. Do not infer values from the repository
> name, from a datasheet for a similar module, or from a previous project.

| Item                  | Value |
| --------------------- | ----- |
| Board model           | _TBD_ |
| Chip / variant        | _TBD_ |
| Flash size            | _TBD_ |
| PSRAM size and mode   | _TBD_ |
| USB configuration     | _TBD_ |
| Bootloader / DFU mode | _TBD_ |
| Partition table       | _TBD_ |
| Power input           | _TBD_ |

### Pin map

_TBD — no pin assignments until the board is confirmed._

| Function | Pin | Notes |
| -------- | --- | ----- |
|          |     |       |

### Peripherals

_TBD_

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

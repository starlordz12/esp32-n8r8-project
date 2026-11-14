# Radio source filtering and secondary-board rollout

Windows-only local tools. Read `docs/PROJECT_GUIDE.md` first. These tools do not
run in CI and do not change the firmware lock. Network addresses, serial ports,
DPAPI helpers, encrypted profiles, source-selection files, model data and backups
stay outside Git. Never print credentials or put them in process arguments.

Tested dependencies: `esptool==5.6.0`, `esp-idf-nvs-partition-gen==0.3.0`.
Run synthetic checks with:

```powershell
uv run --no-project --with esptool==5.6.0 --with esp-idf-nvs-partition-gen==0.3.0 python -m unittest discover -s tools/radio-source -v
```

## Existing-node source filter

`configure_source.py apply` takes `--port`, `--private-root`, `--backup`, and
`--node-id`. The private root must contain the existing `credential_store.py`,
`wifi-profile.dpapi`, and `radio-source.local.json`. Source selection must identify
one verified 2.4 GHz transmitter for the intended saved network; do not guess a
MAC address from a router label or gateway address.

The tool verifies the documented chip, independently reads the complete NVS
partition twice, checks the current network configuration against the encrypted
profile, and saves/round-trips a DPAPI-encrypted backup. It appends an officially
generated filter blob into unused v2 NVS slots while preserving existing entries
and namespaces. It refuses an existing filter or insufficient free slots. Written
NVS bytes are read back and compared. Firmware is not replaced.

`configure_source.py restore` accepts the same arguments and restores the exact
saved NVS after checking device identity and backup integrity. Either action
resets the radio and can invalidate an active calibration; coordinate that first.

## New secondary boards

Use one board at a time, its COM-labeled connector, and a single power source.
Rediscover ports. Do not reuse the first node's port or guess device identity.

1. Run `backup_board.py` with `--port`, `--private-root`, and a unique `--backup`
   path. It requires a distinct ESP32-S3 with 8 MB flash, reads all flash twice,
   verifies hashes, and saves/round-trips a DPAPI-encrypted recovery image. It
   refuses to overwrite a backup or operate on the recorded first node.
2. Run `flash_node.py flash` with those arguments plus a unique `--node-id`
   in 2..5, `--package` pointing to the verified image package, and `--lock`
   pointing to `ruview.lock.json`. It checks package commit, chip, flash settings,
   artifact names, offsets, and SHA-256 values. It matches the connected device
   to its recovery backup, generates NVS in memory with saved credentials and the
   verified transmitter filter, writes the locked images/NVS, and verifies every
   written region before reset. No credentials are placed in argv or temp files.
3. Confirm the unique node reaches the aggregator, remains fresh, and advances its
   CSI sample counter. Record the local soak length and limits privately.
4. Stop before the next board if any identity, checksum, readback, Wi-Fi, or CSI
   check fails. Do not apply another node's room model to the new radio.

`flash_node.py restore` uses the same device-bound encrypted recovery backup to
restore the full original flash. Never use a backup from a different board.

The private first-node NVS backup is also used to exclude that board from the
secondary-board commands. Keep it available alongside the encrypted Wi-Fi profile.

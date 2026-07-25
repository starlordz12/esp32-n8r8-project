# CSI host tools

This directory contains hardware-independent tooling for the first phase of the
project:

- a strict parser and serializer for RuView's documented ADR-018 CSI datagram;
- a deterministic synthetic CSI generator for transport, storage, and UI testing;
- a UDP receiver that records full I/Q frames or compact summaries as JSONL;
- standard-library unit tests that run without ESP32 hardware.

## Quick start

Use Python 3.11 or newer from the repository root.

Terminal 1:

```powershell
$env:PYTHONPATH = "host"
python -m csi_lab.receiver --count 100 --output captures/simulated.jsonl
```

Terminal 2:

```powershell
$env:PYTHONPATH = "host"
python -m csi_lab.simulator --state motion --count 100
```

Run the tests:

```powershell
$env:PYTHONPATH = "host"
python -m unittest discover -s host/tests -v
```

## Evidence boundary

Synthetic states are intentionally simple signal patterns. They validate packet
handling and software integration only. They do **not** demonstrate presence,
through-wall sensing, pose estimation, breathing rate, or heart rate accuracy.
Those claims require captured CSI, labeled experiments, and reported metrics.

## Upstream protocol

ADR-018 is documented by the
[RuView ESP32 CSI firmware](https://github.com/ruvnet/RuView/tree/main/firmware/esp32-csi-node).
This implementation was written against that public wire specification so captured
RuView frames can be studied reproducibly. No upstream firmware source is vendored
in this repository.

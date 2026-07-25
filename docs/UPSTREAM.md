# Upstream relationship and claim boundaries

## RuView

This project is inspired by and interoperates with
[ruvnet/RuView](https://github.com/ruvnet/RuView), an open-source Wi-Fi Channel
State Information (CSI) sensing platform.

The initial host tools implement the public ADR-018 UDP frame format documented in
RuView's `firmware/esp32-csi-node` guide:

- magic `0xC5110001`;
- node and antenna metadata;
- subcarrier count, frequency, sequence, RSSI, and noise floor;
- signed 8-bit I/Q pairs.

The RuView repository is MIT licensed, and its ESP32 firmware documentation states
that the firmware is available under MIT OR Apache-2.0. Any future reuse of upstream
source must preserve the applicable copyright and license notices.

## What belongs to this project

Our portfolio contribution is the reproducible experiment and validation layer:

- independent protocol conformance tests;
- deterministic simulation for software development;
- capture and replay tooling;
- board-specific bring-up evidence;
- labeled experiments and metrics;
- documented failures, limitations, and environmental sensitivity.

## Claims policy

Repository documentation must distinguish:

1. **Simulated:** software behavior exercised with generated I/Q values.
2. **Bench validated:** behavior observed with boards in the same room.
3. **Through-wall validated:** behavior measured across a documented wall material,
   distance, node geometry, and test protocol.

Pose, person count, breathing, heart rate, and fall-detection claims require their
own labeled datasets and evaluation results. A working visualization is not evidence
of accuracy.

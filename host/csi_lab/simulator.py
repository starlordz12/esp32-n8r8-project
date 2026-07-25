"""Deterministic synthetic CSI source for integration tests and UI development."""

from __future__ import annotations

import argparse
import math
import random
import socket
import time
from typing import Literal

from .protocol import CsiFrame

SimulationState = Literal["empty", "presence", "motion"]
SIMULATION_STATES: tuple[SimulationState, ...] = ("empty", "presence", "motion")


def _clip_int8(value: float) -> int:
    return max(-128, min(127, round(value)))


def generate_frame(
    *,
    state: SimulationState,
    sequence: int,
    node_id: int = 1,
    n_antennas: int = 1,
    n_subcarriers: int = 64,
    frequency_mhz: int = 2412,
    frame_rate_hz: float = 20.0,
    seed: int = 1,
) -> CsiFrame:
    """Create a repeatable frame with deliberately simple, non-physical patterns.

    These patterns exercise transport and visualization code. They are not a
    substitute for captured RF data and do not validate sensing accuracy.
    """

    if state not in SIMULATION_STATES:
        raise ValueError(f"unknown simulation state: {state}")
    if frame_rate_hz <= 0:
        raise ValueError("frame_rate_hz must be positive")

    timestamp_s = sequence / frame_rate_hz
    random_source = random.Random((seed << 32) ^ sequence)
    samples: list[tuple[int, int]] = []

    for antenna in range(n_antennas):
        for subcarrier in range(n_subcarriers):
            carrier_phase = subcarrier * 0.11 + antenna * 0.37
            amplitude = 24.0 + 2.0 * math.sin(subcarrier * 0.19)
            phase_delta = 0.0

            if state == "presence":
                phase_delta = 0.12 * math.sin(
                    2.0 * math.pi * 0.25 * timestamp_s + subcarrier * 0.035
                )
                amplitude += 2.5 * math.sin(subcarrier * 0.08 + timestamp_s * 0.4)
            elif state == "motion":
                phase_delta = 0.65 * math.sin(
                    2.0 * math.pi * 1.2 * timestamp_s + subcarrier * 0.17
                )
                amplitude += 8.0 * math.sin(
                    2.0 * math.pi * 0.9 * timestamp_s + subcarrier * 0.13
                )

            phase = carrier_phase + phase_delta + random_source.gauss(0.0, 0.015)
            noisy_amplitude = amplitude + random_source.gauss(0.0, 0.35)
            samples.append(
                (
                    _clip_int8(noisy_amplitude * math.cos(phase)),
                    _clip_int8(noisy_amplitude * math.sin(phase)),
                )
            )

    return CsiFrame(
        node_id=node_id,
        n_antennas=n_antennas,
        frequency_mhz=frequency_mhz,
        sequence=sequence,
        rssi_dbm=-48 if state == "empty" else -46,
        noise_floor_dbm=-96,
        samples=tuple(samples),
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="receiver address")
    parser.add_argument("--port", type=int, default=5005, help="receiver UDP port")
    parser.add_argument("--state", choices=SIMULATION_STATES, default="empty")
    parser.add_argument("--rate", type=float, default=20.0, help="frames per second")
    parser.add_argument(
        "--count", type=int, default=0, help="frames to send; 0 runs until interrupted"
    )
    parser.add_argument("--node-id", type=int, default=1)
    parser.add_argument("--subcarriers", type=int, default=64)
    parser.add_argument("--seed", type=int, default=1)
    return parser


def main() -> None:
    args = _build_parser().parse_args()
    if args.rate <= 0:
        raise SystemExit("--rate must be positive")
    if args.count < 0:
        raise SystemExit("--count cannot be negative")

    interval_s = 1.0 / args.rate
    sequence = 0
    next_send = time.monotonic()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
        try:
            while args.count == 0 or sequence < args.count:
                frame = generate_frame(
                    state=args.state,
                    sequence=sequence,
                    node_id=args.node_id,
                    n_subcarriers=args.subcarriers,
                    frame_rate_hz=args.rate,
                    seed=args.seed,
                )
                udp_socket.sendto(frame.to_bytes(), (args.host, args.port))
                sequence += 1
                next_send += interval_s
                time.sleep(max(0.0, next_send - time.monotonic()))
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

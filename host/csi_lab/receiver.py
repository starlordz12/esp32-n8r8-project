"""Receive ADR-018 CSI datagrams and record newline-delimited JSON."""

from __future__ import annotations

import argparse
from contextlib import nullcontext
import json
from pathlib import Path
import socket
import sys
from typing import TextIO

from .protocol import CsiFrame, ProtocolError


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="0.0.0.0", help="local interface")
    parser.add_argument("--port", type=int, default=5005, help="local UDP port")
    parser.add_argument(
        "--output", type=Path, help="JSONL capture path; defaults to standard output"
    )
    parser.add_argument(
        "--count", type=int, default=0, help="valid frames to capture; 0 runs forever"
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="omit raw I/Q values from each JSON record",
    )
    return parser


def _output_context(path: Path | None):
    if path is None:
        return nullcontext(sys.stdout)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path.open("a", encoding="utf-8")


def _write_record(
    output: TextIO,
    frame: CsiFrame,
    source: tuple[str, int],
    *,
    include_samples: bool,
) -> None:
    record = frame.to_json_dict(include_samples=include_samples)
    record["source"] = {"host": source[0], "port": source[1]}
    json.dump(record, output, separators=(",", ":"))
    output.write("\n")
    output.flush()


def main() -> None:
    args = _build_parser().parse_args()
    if args.count < 0:
        raise SystemExit("--count cannot be negative")

    valid_frames = 0
    with _output_context(args.output) as output, socket.socket(
        socket.AF_INET, socket.SOCK_DGRAM
    ) as udp_socket:
        udp_socket.bind((args.bind, args.port))
        try:
            while args.count == 0 or valid_frames < args.count:
                datagram, source = udp_socket.recvfrom(65535)
                try:
                    frame = CsiFrame.from_bytes(datagram)
                except ProtocolError as error:
                    print(f"dropped malformed datagram from {source}: {error}", file=sys.stderr)
                    continue
                _write_record(
                    output,
                    frame,
                    source,
                    include_samples=not args.summary_only,
                )
                valid_frames += 1
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

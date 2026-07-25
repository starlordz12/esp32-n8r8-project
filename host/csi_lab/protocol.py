"""Parser and serializer for RuView's documented ADR-018 CSI frame."""

from __future__ import annotations

from dataclasses import dataclass
import math
import struct
from typing import Any, Iterable

ADR018_MAGIC = 0xC5110001
_HEADER = struct.Struct("<IBBHIIbbH")
_HEADER_SIZE = _HEADER.size


class ProtocolError(ValueError):
    """Raised when a CSI datagram violates the ADR-018 wire contract."""


def _require_range(name: str, value: int, minimum: int, maximum: int) -> None:
    if not minimum <= value <= maximum:
        raise ProtocolError(f"{name} must be in [{minimum}, {maximum}], got {value}")


def _normalize_samples(samples: Iterable[tuple[int, int]]) -> tuple[tuple[int, int], ...]:
    normalized = tuple(samples)
    for index, sample in enumerate(normalized):
        if len(sample) != 2:
            raise ProtocolError(f"sample {index} must contain exactly one I/Q pair")
        _require_range(f"sample[{index}].i", sample[0], -128, 127)
        _require_range(f"sample[{index}].q", sample[1], -128, 127)
    return normalized


@dataclass(frozen=True, slots=True)
class CsiFrame:
    """One CSI observation containing antenna-major signed I/Q samples."""

    node_id: int
    n_antennas: int
    frequency_mhz: int
    sequence: int
    rssi_dbm: int
    noise_floor_dbm: int
    samples: tuple[tuple[int, int], ...]

    def __post_init__(self) -> None:
        _require_range("node_id", self.node_id, 0, 255)
        _require_range("n_antennas", self.n_antennas, 1, 255)
        _require_range("frequency_mhz", self.frequency_mhz, 1, 0xFFFFFFFF)
        _require_range("sequence", self.sequence, 0, 0xFFFFFFFF)
        _require_range("rssi_dbm", self.rssi_dbm, -128, 127)
        _require_range("noise_floor_dbm", self.noise_floor_dbm, -128, 127)

        normalized = _normalize_samples(self.samples)
        if not normalized:
            raise ProtocolError("at least one I/Q sample is required")
        if len(normalized) % self.n_antennas:
            raise ProtocolError(
                "sample count must be divisible by n_antennas "
                f"({len(normalized)} vs {self.n_antennas})"
            )
        object.__setattr__(self, "samples", normalized)
        _require_range("n_subcarriers", self.n_subcarriers, 1, 0xFFFF)

    @property
    def n_subcarriers(self) -> int:
        return len(self.samples) // self.n_antennas

    @property
    def amplitudes(self) -> tuple[float, ...]:
        return tuple(math.hypot(i_value, q_value) for i_value, q_value in self.samples)

    def to_bytes(self) -> bytes:
        header = _HEADER.pack(
            ADR018_MAGIC,
            self.node_id,
            self.n_antennas,
            self.n_subcarriers,
            self.frequency_mhz,
            self.sequence,
            self.rssi_dbm,
            self.noise_floor_dbm,
            0,
        )
        flattened = tuple(component for sample in self.samples for component in sample)
        return header + struct.pack(f"<{len(flattened)}b", *flattened)

    @classmethod
    def from_bytes(cls, datagram: bytes) -> "CsiFrame":
        if len(datagram) < _HEADER_SIZE:
            raise ProtocolError(
                f"datagram is shorter than the {_HEADER_SIZE}-byte ADR-018 header"
            )

        (
            magic,
            node_id,
            n_antennas,
            n_subcarriers,
            frequency_mhz,
            sequence,
            rssi_dbm,
            noise_floor_dbm,
            _reserved,
        ) = _HEADER.unpack_from(datagram)

        if magic != ADR018_MAGIC:
            raise ProtocolError(
                f"unexpected magic 0x{magic:08X}; expected 0x{ADR018_MAGIC:08X}"
            )
        if n_antennas == 0 or n_subcarriers == 0:
            raise ProtocolError("n_antennas and n_subcarriers must both be non-zero")

        sample_count = n_antennas * n_subcarriers
        expected_size = _HEADER_SIZE + sample_count * 2
        if len(datagram) != expected_size:
            raise ProtocolError(
                f"datagram has {len(datagram)} bytes; header declares {expected_size}"
            )

        values = struct.unpack_from(f"<{sample_count * 2}b", datagram, _HEADER_SIZE)
        samples = tuple(zip(values[0::2], values[1::2], strict=True))
        return cls(
            node_id=node_id,
            n_antennas=n_antennas,
            frequency_mhz=frequency_mhz,
            sequence=sequence,
            rssi_dbm=rssi_dbm,
            noise_floor_dbm=noise_floor_dbm,
            samples=samples,
        )

    def to_json_dict(self, *, include_samples: bool = True) -> dict[str, Any]:
        amplitudes = self.amplitudes
        result: dict[str, Any] = {
            "node_id": self.node_id,
            "n_antennas": self.n_antennas,
            "n_subcarriers": self.n_subcarriers,
            "frequency_mhz": self.frequency_mhz,
            "sequence": self.sequence,
            "rssi_dbm": self.rssi_dbm,
            "noise_floor_dbm": self.noise_floor_dbm,
            "mean_amplitude": sum(amplitudes) / len(amplitudes),
            "peak_amplitude": max(amplitudes),
        }
        if include_samples:
            result["iq"] = [list(sample) for sample in self.samples]
        return result

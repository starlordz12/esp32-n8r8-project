from __future__ import annotations

import unittest

from csi_lab.protocol import CsiFrame
from csi_lab.simulator import generate_frame


class SimulatorTests(unittest.TestCase):
    def test_output_is_deterministic(self) -> None:
        first = generate_frame(state="presence", sequence=42, seed=9)
        second = generate_frame(state="presence", sequence=42, seed=9)
        self.assertEqual(first, second)

    def test_generated_frame_round_trips_over_wire_format(self) -> None:
        frame = generate_frame(
            state="motion",
            sequence=5,
            n_antennas=2,
            n_subcarriers=32,
        )
        self.assertEqual(CsiFrame.from_bytes(frame.to_bytes()), frame)
        self.assertEqual(frame.n_subcarriers, 32)

    def test_scenarios_produce_distinct_observations(self) -> None:
        empty = generate_frame(state="empty", sequence=18)
        presence = generate_frame(state="presence", sequence=18)
        motion = generate_frame(state="motion", sequence=18)
        self.assertNotEqual(empty.samples, presence.samples)
        self.assertNotEqual(presence.samples, motion.samples)

    def test_invalid_rate_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "frame_rate_hz"):
            generate_frame(state="empty", sequence=0, frame_rate_hz=0)


if __name__ == "__main__":
    unittest.main()

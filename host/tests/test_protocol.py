from __future__ import annotations

import struct
import unittest

from csi_lab.protocol import ADR018_MAGIC, CsiFrame, ProtocolError


class CsiFrameTests(unittest.TestCase):
    def setUp(self) -> None:
        self.frame = CsiFrame(
            node_id=7,
            n_antennas=2,
            frequency_mhz=2437,
            sequence=1234,
            rssi_dbm=-51,
            noise_floor_dbm=-96,
            samples=((1, -2), (3, -4), (5, -6), (7, -8)),
        )

    def test_round_trip_preserves_frame(self) -> None:
        encoded = self.frame.to_bytes()
        self.assertEqual(len(encoded), 28)
        self.assertEqual(CsiFrame.from_bytes(encoded), self.frame)

    def test_wire_header_uses_documented_magic(self) -> None:
        encoded = self.frame.to_bytes()
        (magic,) = struct.unpack_from("<I", encoded)
        self.assertEqual(magic, ADR018_MAGIC)

    def test_rejects_wrong_magic(self) -> None:
        encoded = bytearray(self.frame.to_bytes())
        encoded[0:4] = b"\x00\x00\x00\x00"
        with self.assertRaisesRegex(ProtocolError, "unexpected magic"):
            CsiFrame.from_bytes(bytes(encoded))

    def test_rejects_truncated_payload(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "header declares"):
            CsiFrame.from_bytes(self.frame.to_bytes()[:-1])

    def test_rejects_out_of_range_sample(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "sample\\[0\\]\\.i"):
            CsiFrame(
                node_id=1,
                n_antennas=1,
                frequency_mhz=2412,
                sequence=0,
                rssi_dbm=-50,
                noise_floor_dbm=-96,
                samples=((128, 0),),
            )

    def test_json_summary_can_omit_raw_samples(self) -> None:
        summary = self.frame.to_json_dict(include_samples=False)
        self.assertEqual(summary["n_subcarriers"], 2)
        self.assertNotIn("iq", summary)


if __name__ == "__main__":
    unittest.main()

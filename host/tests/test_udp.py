from __future__ import annotations

import socket
import unittest

from csi_lab.protocol import CsiFrame
from csi_lab.simulator import generate_frame


class UdpIntegrationTests(unittest.TestCase):
    def test_simulated_frame_crosses_udp_socket(self) -> None:
        expected = generate_frame(state="motion", sequence=27, seed=4)

        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as receiver:
            receiver.bind(("127.0.0.1", 0))
            receiver.settimeout(2.0)
            destination = receiver.getsockname()

            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
                sent = sender.sendto(expected.to_bytes(), destination)

            datagram, source = receiver.recvfrom(65535)

        self.assertEqual(sent, len(expected.to_bytes()))
        self.assertEqual(source[0], "127.0.0.1")
        self.assertEqual(CsiFrame.from_bytes(datagram), expected)


if __name__ == "__main__":
    unittest.main()

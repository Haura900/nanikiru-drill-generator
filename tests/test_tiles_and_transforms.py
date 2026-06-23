from __future__ import annotations

import unittest

from nanikiru_factory.tiles import (
    parse_melds,
    parse_mpsz,
    tiles_to_mpsz,
    validate_hand,
    validate_tile_counts,
)


class TileTests(unittest.TestCase):
    def test_mpsz_round_trip(self) -> None:
        text = "45m2344779p23368s"
        self.assertEqual(tiles_to_mpsz(parse_mpsz(text)), text)
        self.assertEqual(len(validate_hand(text)), 14)

    def test_too_many_tiles(self) -> None:
        with self.assertRaises(ValueError):
            parse_mpsz("11111m")

    def test_parse_multiple_pon_and_chi(self) -> None:
        melds = parse_melds("123m, 777z / 456p")
        self.assertEqual([meld["type"] for meld in melds], [1, 0, 1])
        self.assertEqual([meld["mpsz"] for meld in melds], ["123m", "777z", "456p"])

    def test_open_hand_tile_count(self) -> None:
        melds = parse_melds("777z")
        hand = validate_hand("56m5689p44667s", len(melds))
        validate_tile_counts(hand, melds)
        self.assertEqual(len(hand), 11)

    def test_invalid_meld_shape(self) -> None:
        with self.assertRaises(ValueError):
            parse_melds("135m")

if __name__ == "__main__":
    unittest.main()

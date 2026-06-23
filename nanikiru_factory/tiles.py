from __future__ import annotations

from collections import Counter
import re

TILE_CODES = (
    [f"{rank}m" for rank in range(1, 10)]
    + [f"{rank}p" for rank in range(1, 10)]
    + [f"{rank}s" for rank in range(1, 10)]
    + [f"{rank}z" for rank in range(1, 8)]
)
CODE_TO_INDEX = {code: index for index, code in enumerate(TILE_CODES)}
INDEX_TO_CODE = {index: code for code, index in CODE_TO_INDEX.items()}
SUIT_ORDER = {"m": 0, "p": 1, "s": 2, "z": 3}


def normalize_tile(code: str) -> str:
    code = code.strip().lower()
    if len(code) != 2 or code[1] not in "mpsz" or not code[0].isdigit():
        raise ValueError(f"不正な牌です: {code}")
    rank = int(code[0])
    if code[1] == "z":
        if not 1 <= rank <= 7:
            raise ValueError(f"字牌は1z～7zで入力してください: {code}")
    elif not 0 <= rank <= 9:
        raise ValueError(f"数牌は1～9で入力してください: {code}")
    if rank == 0:
        rank = 5
    return f"{rank}{code[1]}"


def parse_mpsz(text: str) -> list[str]:
    compact = re.sub(r"\s+", "", text.lower())
    digits: list[str] = []
    tiles: list[str] = []
    for char in compact:
        if char.isdigit():
            digits.append(char)
        elif char in "mpsz":
            if not digits:
                raise ValueError(f"{char} の前に数字がありません")
            tiles.extend(normalize_tile(f"{digit}{char}") for digit in digits)
            digits = []
        else:
            raise ValueError(f"使用できない文字です: {char}")
    if digits:
        raise ValueError("末尾の数字に牌種がありません")
    if not tiles:
        raise ValueError("手牌が空です")
    counts = Counter(tiles)
    over = [tile for tile, count in counts.items() if count > 4]
    if over:
        raise ValueError(f"同じ牌が5枚以上あります: {', '.join(over)}")
    return sort_tiles(tiles)


def sort_tiles(tiles: list[str]) -> list[str]:
    return sorted(
        (normalize_tile(tile) for tile in tiles),
        key=lambda code: (SUIT_ORDER[code[1]], int(code[0])),
    )


def tiles_to_mpsz(tiles: list[str]) -> str:
    sorted_tiles = sort_tiles(tiles)
    groups: list[str] = []
    for suit in "mpsz":
        ranks = [tile[0] for tile in sorted_tiles if tile[1] == suit]
        if ranks:
            groups.append("".join(ranks) + suit)
    return "".join(groups)


def validate_hand(text: str, meld_count: int = 0) -> list[str]:
    tiles = parse_mpsz(text)
    expected = 14 - meld_count * 3
    if len(tiles) != expected:
        raise ValueError(
            f"副露{meld_count}組の何切る問題は手牌を{expected}枚で入力してください"
            f"（現在{len(tiles)}枚）"
        )
    return tiles


def parse_melds(text: str) -> list[dict]:
    raw = str(text or "").strip().lower()
    if not raw:
        return []
    tokens = re.findall(r"([0-9]+)([mpsz])", raw)
    consumed = "".join(f"{digits}{suit}" for digits, suit in tokens)
    compact = re.sub(r"[\s,、・/;|]+", "", raw)
    if consumed != compact:
        raise ValueError("副露は例のように入力してください: 123m 777z")
    melds: list[dict] = []
    for digits, suit in tokens:
        if len(digits) % 3 != 0:
            raise ValueError(f"副露1組は3枚です: {digits}{suit}")
        for offset in range(0, len(digits), 3):
            tiles = sort_tiles(
                [normalize_tile(f"{digit}{suit}") for digit in digits[offset : offset + 3]]
            )
            ranks = [int(tile[0]) for tile in tiles]
            if len(set(tiles)) == 1:
                meld_type = 0
                name = "ポン"
            elif suit != "z" and ranks[1] == ranks[0] + 1 and ranks[2] == ranks[1] + 1:
                meld_type = 1
                name = "チー"
            else:
                raise ValueError(
                    f"ポンまたはチーの形ではありません: {tiles_to_mpsz(tiles)}"
                )
            melds.append(
                {
                    "type": meld_type,
                    "name": name,
                    "tiles": tiles,
                    "mpsz": tiles_to_mpsz(tiles),
                }
            )
    if len(melds) > 4:
        raise ValueError("副露は4組までです")
    return melds


def melds_to_text(melds: list[dict]) -> str:
    return " ".join(
        meld.get("mpsz") or tiles_to_mpsz(meld.get("tiles", []))
        for meld in melds
    )


def validate_tile_counts(hand_tiles: list[str], melds: list[dict]) -> None:
    counts = Counter(hand_tiles)
    for meld in melds:
        counts.update(normalize_tile(tile) for tile in meld.get("tiles", []))
    over = [tile for tile, count in counts.items() if count > 4]
    if over:
        raise ValueError(f"手牌と副露を合わせて同じ牌が5枚以上あります: {', '.join(over)}")


def tile_asset_name(code: str) -> str:
    code = normalize_tile(code)
    prefix = {"m": "man", "p": "pin", "s": "sou", "z": "ji"}[code[1]]
    return f"{prefix}{code[0]}-66-90-s.png"

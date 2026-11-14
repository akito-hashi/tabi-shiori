"""旅のしおりのアプリアイコン (PNG) を生成する。追加ライブラリ不要。

使い方: python3 tools/make_icons.py   （tabi-shiori フォルダで実行）
青い背景に、白いしおり（下が V 字に切れた帯）と、黄色い太陽を描く。
"""
import os
import struct
import zlib

BG = (31, 111, 139)      # #1f6f8b（アプリのアクセント色）
WHITE = (250, 252, 252)
SUN = (243, 190, 74)     # 山吹
SIZES = [180, 192, 512]
SS = 4  # アンチエイリアス用のサンプル数（縦横）


def color_at(px, py, size):
    """座標 (px, py) の色。上にあるものから順に判定する"""
    u, v = px / size, py / size  # 0..1
    # 太陽（右上）
    if (u - 0.68) ** 2 + (v - 0.30) ** 2 <= 0.085 ** 2:
        return SUN
    # しおり：中央の縦長の帯、下端は V 字に切れている（Android の丸型マスクにも収まる大きさ）
    left, right, top, bottom, notch = 0.36, 0.58, 0.22, 0.78, 0.10
    if left <= u <= right and top <= v <= bottom:
        mid = (left + right) / 2
        depth = notch * (1 - abs(u - mid) / ((right - left) / 2))  # 中央ほど深く切れる
        if v <= bottom - depth:
            return WHITE
    return BG


def make_png(size):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0]
            for i in range(SS):
                for j in range(SS):
                    c = color_at(x + (i + 0.5) / SS, y + (j + 0.5) / SS, size)
                    for k in range(3):
                        acc[k] += c[k]
            row += bytes(round(a / (SS * SS)) for a in acc)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    os.makedirs(out, exist_ok=True)
    for s in SIZES:
        with open(os.path.join(out, f"icon-{s}.png"), "wb") as f:
            f.write(make_png(s))
        print("wrote", f"icons/icon-{s}.png")

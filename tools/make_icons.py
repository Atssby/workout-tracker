#!/usr/bin/env python3
"""アプリアイコン（PWA / ホーム画面）を生成する。

使い方:
    python tools/make_icons.py          # Windows
    python3 tools/make_icons.py         # Mac

出力: docs/icon-192.png, docs/icon-512.png（docs/icon.svg と同じデザイン）

デザイン: インディゴのグラデーション背景 + 白いダンベル。
maskable 対応のため背景は全面塗り、図形は中央 80% のセーフゾーン内に収める。
"""

from pathlib import Path

from PIL import Image, ImageDraw

DOCS = Path(__file__).resolve().parent.parent / "docs"
SIZE = 512          # 基準サイズ（この座標系で描いてから縮小する）
SS = 4              # スーパーサンプリング倍率（輪郭のギザギザ防止）
TOP = (99, 102, 241)      # #6366f1
BOTTOM = (67, 56, 202)    # #4338ca


def build_base() -> Image.Image:
    canvas = SIZE * SS
    img = Image.new("RGB", (canvas, canvas), TOP)
    draw = ImageDraw.Draw(img)

    # 背景: 縦方向グラデーション
    for y in range(canvas):
        t = y / (canvas - 1)
        color = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (canvas, y)], fill=color)

    def plate(x0, y0, x1, y1, radius):
        draw.rounded_rectangle(
            [x0 * SS, y0 * SS, x1 * SS, y1 * SS], radius=radius * SS, fill="white"
        )

    # ダンベル（左右対称・中心 256,256）
    plate(187, 239, 325, 273, 14)   # バー
    plate(141, 182, 187, 330, 16)   # 内側プレート（左）
    plate(325, 182, 371, 330, 16)   # 内側プレート（右）
    plate(104, 208, 141, 305, 14)   # 外側プレート（左）
    plate(371, 208, 408, 305, 14)   # 外側プレート（右）

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    base = build_base()
    for size in (512, 192):
        out = DOCS / f"icon-{size}.png"
        img = base if size == SIZE else base.resize((size, size), Image.LANCZOS)
        img.save(out, "PNG", optimize=True)
        print(f"wrote {out} ({size}x{size})")


if __name__ == "__main__":
    main()

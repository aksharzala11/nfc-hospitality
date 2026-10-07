"""
Build the web assets for the NAAM 2026 "Sachu" Karyakar theme from the organisers'
Digital Assets folder (Brand Guide.pdf, Fonts/, Logo/, Wallpapers/, ID Cards/).

    python scripts/build-sachu-assets.py "C:/path/to/Digital Assets"

Writes (all committed):
  public/brand/sachu/logo-{full,flat,single,white}.webp   full lock-up (mark + SACHU x3), 960 px wide (lossless)
  public/brand/sachu/mark-{full,flat,single,white}.webp   the chhatri mark alone, 640 px tall
  public/brand/sachu/apm.webp                             Akshar-Purushottam murti art (unaltered, trimmed)
  public/brand/sachu/baps-footer-white.webp               standard BAPS footer, white, for ink backgrounds
  public/brand/sachu/wallpaper-{dark,light}.webp          phone wallpapers, 750 px wide
  public/favicon.ico, public/apple-touch-icon.png, public/icon-{192,512}.png,
  public/icon-maskable-{192,512}.png                      app icons from the full-colour mark on sand
  src/app/fonts/Enligas-Regular.woff2                     display face ("Enilas" in the guide)
  src/app/fonts/JustSans-Variable.woff2                   body face, variable weight 135-900

Needs Pillow, numpy and fontTools with brotli. Re-running overwrites the outputs.
"""

import sys
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTFont
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SAND = (232, 224, 209)  # #e8e0d1
LOGOS = {"full": "Full Color Logo", "flat": "2 Color Flat Logo", "single": "Single Color Logo", "white": "White Logo"}
# In the 2426 x 1271 lock-ups the mark ends at x=1118 and the wordmark starts at x=1203.
MARK_RIGHT = 1160


def trim(im: Image.Image) -> Image.Image:
    alpha = np.array(im.getchannel("A"))
    ys, xs = np.nonzero(alpha > 8)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def save_webp(im: Image.Image, path: Path, quality: int = 90, lossless: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=quality, lossless=lossless, method=6)
    print(f"  {path.relative_to(REPO)}  {im.size[0]}x{im.size[1]}  {path.stat().st_size // 1024} KB")


def icon(mark: Image.Image, size: int, fill: float, rounded: bool) -> Image.Image:
    """The mark centred on sand; `fill` = fraction of the canvas the mark's longer side uses."""
    canvas = Image.new("RGBA", (size, size), SAND + (255,))
    m = mark.copy()
    m.thumbnail((int(size * fill), int(size * fill)), Image.LANCZOS)
    canvas.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    if rounded:
        mask = Image.new("L", (size * 4, size * 4), 0)
        from PIL import ImageDraw

        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * 0.22), fill=255)
        canvas.putalpha(mask.resize((size, size), Image.LANCZOS))
    return canvas


def woff2(src: Path, dst: Path) -> None:
    font = TTFont(src)
    font.flavor = "woff2"
    dst.parent.mkdir(parents=True, exist_ok=True)
    font.save(dst)
    print(f"  {dst.relative_to(REPO)}  {dst.stat().st_size // 1024} KB")


def main(assets: Path) -> None:
    out = REPO / "public" / "brand" / "sachu"
    print("Logos and marks:")
    marks = {}
    for key, name in LOGOS.items():
        full = Image.open(assets / "Logo" / "PNG" / f"{name}.png").convert("RGBA")
        lockup = trim(full)
        lockup.thumbnail((960, 960), Image.LANCZOS)
        save_webp(lockup, out / f"logo-{key}.webp", lossless=True)
        mark = trim(full.crop((0, 0, MARK_RIGHT, full.height)))
        marks[key] = mark
        m = mark.copy()
        m.thumbnail((640, 640), Image.LANCZOS)
        save_webp(m, out / f"mark-{key}.webp", lossless=True)

    print("Murti, footer, wallpapers:")
    apm = trim(Image.open(assets / "ID Cards" / "02. Assets" / "APM-3.png").convert("RGBA"))
    apm.thumbnail((1000, 1000), Image.LANCZOS)
    save_webp(apm, out / "apm.webp", quality=88)
    footer = trim(Image.open(assets / "ID Cards" / "02. Assets" / "Standard Footer-White-Pragat Brahmaswarup.png").convert("RGBA"))
    footer.thumbnail((1400, 1400), Image.LANCZOS)
    save_webp(footer, out / "baps-footer-white.webp", quality=90)
    for kind in ("Dark", "Light"):
        wall = Image.open(assets / "Wallpapers" / f"Phone Wallpaper - {kind}.jpg").convert("RGB")
        wall.thumbnail((750, 1700), Image.LANCZOS)
        save_webp(wall, out / f"wallpaper-{kind.lower()}.webp", quality=62)

    print("App icons (full-colour mark on sand):")
    mark = marks["full"]
    public = REPO / "public"
    icon(mark, 180, 0.74, rounded=False).convert("RGB").save(public / "apple-touch-icon.png", optimize=True)
    for size in (192, 512):
        icon(mark, size, 0.78, rounded=True).save(public / f"icon-{size}.png", optimize=True)
        icon(mark, size, 0.56, rounded=False).convert("RGB").save(public / f"icon-maskable-{size}.png", optimize=True)
    # Small sizes: the single-colour mark reads better than the gradient.
    small = icon(marks["single"], 256, 0.84, rounded=True)
    small.save(public / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for p in ("apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "favicon.ico"):
        print(f"  public/{p}  {(public / p).stat().st_size // 1024} KB")

    print("Fonts:")
    fonts = REPO / "src" / "app" / "fonts"
    woff2(assets / "Fonts" / "Enligas-Regular.ttf", fonts / "Enligas-Regular.woff2")
    woff2(assets / "Fonts" / "Just-Sans" / "Variable" / "JUST Sans Variable.ttf", fonts / "JustSans-Variable.woff2")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))

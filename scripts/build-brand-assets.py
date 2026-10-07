#!/usr/bin/env python3
"""
Build the brand images derived from the Edison mandir line art.

    python scripts/build-brand-assets.py [SOURCE] [--out DIR]

SOURCE is the organisers' art: a transparent 2000x996 PNG/WebP of BAPS Shri
Swaminarayan Mandir, Edison NJ. When given, it becomes the new
public/brand/edison-mandir.webp. Without it, everything else is rebuilt from
that file, which keeps the art's full-resolution alpha.
--out writes into another folder (handy for previewing) instead of public/.

Outputs (paths relative to public/):
  brand/edison-mandir.webp      panorama for <MandirArt> (CSS mask: only alpha matters)
  brand/edison-mark.webp        the <Logo> mark: three central shikhars under the
                                beaded arch, strokes thickened to read at 16-44px
With --icons it also rebuilds the old Edison-mark app icons (favicon.ico, apple-touch-icon.png,
icon-*.png). Don't: since the Sachu theme the app icons come from scripts/build-sachu-assets.py.

The crop and arch constants below are measured on the 2000x996 art; re-check
them if the organisers send a differently framed drawing.

Needs Python 3.10+ with Pillow (WebP support), numpy and scipy.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
PANORAMA = "brand/edison-mandir.webp"
MARK = "brand/edison-mark.webp"

ART_SIZE = (2000, 996)
ART_RGB = (0xF6, 0x74, 0x05)  # the drawing's own saffron; masks ignore it
ALPHA_LEVELS = 16  # anti-aliasing steps kept in the masks (halves the file size)

# Beaded arch: circle through the thin outer line of the arch.
ARC_CENTRE = (1000.5, 702.1)
ARC_RADIUS = 684.7
ARC_BAND = (40, 6)  # px inside / outside that line covering the beads and their caps
# The mark keeps the arch from two beads left of the left flag pole to two beads
# right of the right one (angles in degrees, image coordinates, 270 = top).
MARK_ARC_DEG = (246.25, 293.75)
MARK_BOX = (700, 0, 1300, 622)  # three shikhars, domes and parapet (x0, y0, x1, y1)

MARK_HEIGHT = 192  # px; the mark is shown at up to ~44 CSS px on 3x screens
MARK_STROKE = 4  # outline offset in source px for the <Logo> mask

SAFFRON_400 = (0xF5, 0x9E, 0x42)
SAFFRON_600 = (0xC9, 0x5F, 0x0F)


# ---------------------------------------------------------------- helpers


def to_l(a: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), "L")


def quantise(a: np.ndarray, levels: int = ALPHA_LEVELS) -> np.ndarray:
    return np.round(np.clip(a, 0, 1) * (levels - 1)) / (levels - 1)


def save_mask_webp(alpha: Image.Image, path: Path) -> None:
    """Lossless WebP: constant colour, the shape lives in the alpha channel."""
    a = quantise(np.asarray(alpha).astype(np.float32) / 255)
    rgba = Image.new("RGBA", alpha.size, ART_RGB + (0,))
    rgba.putalpha(to_l(a))
    path.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(path, "WEBP", lossless=True, quality=100, method=6)


def disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r : r + 1, -r : r + 1]
    return x * x + y * y <= r * r


def thicken(a: np.ndarray, r: float, ss: int = 2) -> np.ndarray:
    """Push every outline outward by r source px (signed distance field at ss x
    supersampling), returning anti-aliased coverage at the source resolution."""
    h, w = a.shape
    up = np.asarray(to_l(a).resize((w * ss, h * ss), Image.BICUBIC)).astype(np.float32) / 255
    inside = up >= 0.5
    d_out = ndi.distance_transform_edt(~inside)
    d_in = ndi.distance_transform_edt(inside)
    signed = np.where(inside, 0.5 - d_in, d_out - 0.5)
    cov = np.clip(r * ss + 0.5 - signed, 0, 1)
    return cov.reshape(h, ss, w, ss).mean(axis=(1, 3))


def arc_band(shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Boolean mask of the beaded arch (near the top) and each pixel's angle."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    dx, dy = xx - ARC_CENTRE[0], yy - ARC_CENTRE[1]
    d = np.hypot(dx, dy)
    band = (d >= ARC_RADIUS - ARC_BAND[0]) & (d <= ARC_RADIUS + ARC_BAND[1]) & (yy < 300)
    return band, np.degrees(np.arctan2(dy, dx)) % 360


def crop(a: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    return a[y0:y1, x0:x1]


def mark_parts(alpha: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(whole mark region, arch-only part) with the arch trimmed near the flag poles."""
    band, angle = arc_band(alpha.shape)
    lo, hi = MARK_ARC_DEG
    trimmed = alpha.copy()
    trimmed[band & ((angle < lo) | (angle > hi))] = 0
    arch = np.where(band, trimmed, 0)
    return crop(trimmed, MARK_BOX), crop(arch, MARK_BOX)


def silhouette(region: np.ndarray, arch: np.ndarray) -> np.ndarray:
    """Solid version for the tiniest favicon: filled shikhars plus a bold arch."""
    body = np.clip(region - arch, 0, 1)
    solid = thicken(body, 3) >= 0.5
    solid = ndi.binary_fill_holes(ndi.binary_closing(solid, structure=disk(6)))
    return np.maximum(thicken(solid.astype(np.float32), 0), thicken(arch, 6))


def resize(a: np.ndarray, height: int, sharp: bool = False) -> Image.Image:
    img = to_l(a)
    width = round(img.width * height / img.height)
    if sharp:
        return img.resize((width, height), Image.LANCZOS, reducing_gap=3.0)
    return img.resize((width, height), Image.BOX)


def gradient(size: int) -> Image.Image:
    """Diagonal saffron-400 -> saffron-600, as on the app's buttons and tiles."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (x + y) / (2 * (size - 1))
    c0, c1 = np.array(SAFFRON_400, np.float32), np.array(SAFFRON_600, np.float32)
    rgb = c0 + (c1 - c0) * t[..., None]
    return Image.fromarray(np.round(rgb).astype(np.uint8), "RGB").convert("RGBA")


def rounded(size: int, radius: float, ss: int = 4) -> Image.Image:
    big = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, size * ss - 1, size * ss - 1), radius=radius * size * ss, fill=255)
    return big.resize((size, size), Image.LANCZOS)


def icon(size: int, mark: np.ndarray, height: float, corner: float | None = None) -> Image.Image:
    """White mark centred on the saffron gradient; `corner` rounds the tile."""
    tile = gradient(size)
    m = resize(mark, round(size * height), sharp=True)
    white = Image.new("RGBA", m.size, (255, 255, 255, 255))
    tile.paste(white, ((size - m.width) // 2, (size - m.height) // 2), m)
    if corner is not None:
        tile.putalpha(rounded(size, corner))
    return tile


# ---------------------------------------------------------------- main


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", nargs="?", help="the organisers' transparent art (2000x996)")
    parser.add_argument("--out", default=str(PUBLIC), help="output folder (default: public/)")
    parser.add_argument("--icons", action="store_true", help="also write the old Edison app icons (superseded)")
    args = parser.parse_args()
    out = Path(args.out)

    src = Path(args.source) if args.source else PUBLIC / PANORAMA
    art = Image.open(src).convert("RGBA")
    if art.size != ART_SIZE:
        raise SystemExit(f"{src}: expected {ART_SIZE[0]}x{ART_SIZE[1]}, got {art.width}x{art.height}")
    alpha = np.asarray(art.getchannel("A")).astype(np.float32) / 255

    # Panorama: the art itself, alpha only.
    save_mask_webp(to_l(alpha), out / PANORAMA)

    region, arch = mark_parts(alpha)
    strokes = {r: thicken(region, r) for r in (2, MARK_STROKE, 5, 7)}

    # <Logo> mask.
    save_mask_webp(resize(strokes[MARK_STROKE], MARK_HEIGHT), out / MARK)

    if not args.icons:
        for name in (PANORAMA, MARK):
            p = out / name
            print(f"{p.stat().st_size / 1024:7.1f} KB  {p}")
        return

    # App icons (superseded by scripts/build-sachu-assets.py): finer strokes where there are more pixels.
    icon(512, strokes[2], 0.58, corner=0.225).save(out / "icon-512.png", optimize=True)
    icon(192, strokes[MARK_STROKE], 0.58, corner=0.225).save(out / "icon-192.png", optimize=True)
    # Maskable: the safe zone is the central circle of radius 40%; a mark 0.54 of the
    # icon high keeps its corners inside it. Full bleed, so no alpha channel needed.
    icon(512, strokes[2], 0.54).convert("RGB").save(out / "icon-maskable-512.png", optimize=True)
    icon(192, strokes[MARK_STROKE], 0.54).convert("RGB").save(out / "icon-maskable-192.png", optimize=True)
    icon(180, strokes[MARK_STROKE], 0.58).convert("RGB").save(out / "apple-touch-icon.png", optimize=True)

    fav = [
        icon(16, silhouette(region, arch), 0.78, corner=0.2),
        icon(32, strokes[7], 0.72, corner=0.2),
        icon(48, strokes[5], 0.70, corner=0.2),
    ]
    fav[-1].save(out / "favicon.ico", sizes=[f.size for f in fav], append_images=fav[:-1])

    for name in (PANORAMA, MARK, "favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png",
                 "icon-maskable-192.png", "icon-maskable-512.png"):
        p = out / name
        print(f"{p.stat().st_size / 1024:7.1f} KB  {p}")


if __name__ == "__main__":
    main()

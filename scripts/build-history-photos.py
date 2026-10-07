"""
Build the Edison Mandir History page's photographs (/history) from the originals.

    python scripts/build-history-photos.py "<folder with the originals>" [--keep-built]

Reads the originals (named for their event and their order within it, the stems in PHOTOS
below: CFI-1..3, MP96-1..3, GM17-1..3, MM19-1..3 and the organisers' additions of 2026-10-06,
IA88, WB90, TR90, CP90, CC91, EP91, EH94, DG94, EK94, MS95, NY96; .jpg / .jpeg / .png / .webp, any letter case) and
writes, per photo,

    public/history/photos/<key>-960.webp     960 px wide,  WebP q86   (the page, 2x phones)
    public/history/photos/<key>-1280.webp    1280 px wide, WebP q86   (the page, 3x phones)
    public/history/photos/<key>-full.webp    2048 px on the long edge, WebP q88 (the viewer)

and src/lib/historyPhotos.ts (each copy's pixel size and a content hash for the URL).

A copy is never larger than its original: from a smaller original (the 2026-10-06 additions are
the organisers' own exports, 500-1400 px wide) each copy is made at the original's size where
the target is bigger, so the 960 and 1280 copies may be the same size (the page then lists one).

--keep-built: a photo whose original isn't in the folder keeps the copies already built, as
src/lib/historyPhotos.ts records them, provided its three files are still exactly those (their
content hash equals the recorded `v`); otherwise nothing is written. That is how photos are
added without the earlier originals at hand. Without it, every original must be there.

These are sacred images: every copy is the WHOLE frame. The script only turns the picture
upright (its EXIF orientation), converts an embedded colour profile to sRGB (a file without one
is taken as sRGB) and resizes with Lanczos. It never crops, trims (the film prints keep their
scan edges), sharpens or adjusts, and writes no metadata.

It writes nothing when an original is missing, there are two files for one photo, a copy's
aspect ratio is more than 1 px off its original's, or a copy strays too far from its resized
original: under 38 dB PSNR in brightness (luma), or under 30 dB over R, G and B. (WebP stores
colour at half resolution, which caps the RGB figure near 31-37 dB for these pictures whatever
the quality; the brightness figure is the one that tracks visible detail.)

Needs Pillow with WebP and LittleCMS support (pip install Pillow).
"""

from __future__ import annotations

import hashlib
import io
import math
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageCms, ImageOps, ImageStat, features

# The originals are large scans (up to ~51 megapixels): they are the user's own files.
Image.MAX_IMAGE_PIXELS = None

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "public" / "history" / "photos"
MANIFEST = REPO / "src" / "lib" / "historyPhotos.ts"

# key -> the original's file name without its extension, in the page's order.
PHOTOS = [
    # The house on Inman Avenue, 1988 (the organisers, 2026-10-06).
    ("ia88-1", "IA88-1"),
    # July 9, 1990 (the warehouse), the travel report and the CFI planning (the organisers, 2026-10-06).
    ("wb90-1", "WB90-1"),
    ("wb90-2", "WB90-2"),
    ("tr90-1", "TR90-1"),
    ("cp90-1", "CP90-1"),
    ("cfi-1", "CFI-1"),
    ("cfi-2", "CFI-2"),
    ("cfi-3", "CFI-3"),
    # The organisers' additions of 2026-10-06: the close of the CFI, August 21 (1991), Expo Hall,
    # June 2, June 5 (1994), the 1995 visit and the 1996 nagar yatra.
    ("cc91-1", "CC91-1"),
    ("cc91-2", "CC91-2"),
    ("ep91-1", "EP91-1"),
    ("ep91-2", "EP91-2"),
    ("eh94-1", "EH94-1"),
    ("dg94-1", "DG94-1"),
    ("dg94-2", "DG94-2"),
    ("dg94-3", "DG94-3"),
    ("ek94-1", "EK94-1"),
    ("ek94-2", "EK94-2"),
    ("ms95-1", "MS95-1"),
    ("ms95-2", "MS95-2"),
    ("ms95-3", "MS95-3"),
    ("mp96-1", "MP96-1"),
    ("mp96-2", "MP96-2"),
    ("mp96-3", "MP96-3"),
    ("ny96-1", "NY96-1"),
    ("ny96-2", "NY96-2"),
    ("gm17-1", "GM17-1"),
    ("gm17-2", "GM17-2"),
    ("gm17-3", "GM17-3"),
    ("mm19-1", "MM19-1"),
    ("mm19-2", "MM19-2"),
    ("mm19-3", "MM19-3"),
]
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

PAGE_WIDTHS = (960, 1280)
PAGE_QUALITY = 86
FULL_LONG_EDGE = 2048
FULL_QUALITY = 88
MIN_LUMA_PSNR_DB = 38.0
MIN_RGB_PSNR_DB = 30.0


def find_originals(folder: Path, allow_missing: bool = False) -> dict[str, Path]:
    """
    The originals by key; exits when one is ambiguous, or missing unless `allow_missing`
    (--keep-built: a missing one must then have a built copy to keep, see built_copies()).
    """
    by_stem: dict[str, list[Path]] = {}
    for path in folder.iterdir():
        if path.is_file() and path.suffix.lower() in EXTENSIONS:
            by_stem.setdefault(path.stem.upper(), []).append(path)
    found: dict[str, Path] = {}
    problems: list[str] = []
    for key, stem in PHOTOS:
        matches = by_stem.get(stem.upper(), [])
        if len(matches) == 1:
            found[key] = matches[0]
        elif not matches:
            if not allow_missing:
                problems.append(f"missing: {stem} (.jpg / .jpeg / .png / .webp)")
        else:
            problems.append(f"more than one file for {stem}: {', '.join(sorted(p.name for p in matches))}")
    if problems:
        sys.exit("Nothing written.\n  " + "\n  ".join(problems))
    return found


def load_upright_srgb(path: Path, srgb: ImageCms.ImageCmsProfile) -> tuple[Image.Image, str]:
    """The whole picture, upright, in sRGB. Returns it with a note on its colour profile."""
    im = Image.open(path)
    im.load()
    icc = im.info.get("icc_profile")
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        # CMYK and the like need their profile to convert; none of the twelve is one.
        if not icc:
            sys.exit(f"{path.name}: mode {im.mode} without a colour profile; convert it to RGB first.")
    if icc:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        name = (ImageCms.getProfileDescription(source) or "embedded profile").strip()
        im = ImageCms.profileToProfile(
            im, source, srgb, renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, outputMode="RGB"
        )
        note = f"{name} -> sRGB"
    else:
        note = "no profile (taken as sRGB)"
    return im.convert("RGB"), note


def encode(im: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    # No exif / icc_profile arguments: the copies carry no metadata (they are sRGB by now).
    im.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def psnr(a: Image.Image, b: Image.Image) -> float:
    """Peak signal-to-noise ratio over every band of two images of one size and mode."""
    stat = ImageStat.Stat(ImageChops.difference(a, b))
    mse = sum(stat.sum2) / (a.width * a.height * len(stat.sum2))
    return math.inf if mse == 0 else 10 * math.log10(255**2 / mse)


MANIFEST_ROW = re.compile(
    r'"([a-z0-9-]+)": \{ w960: \[(\d+), (\d+)\], w1280: \[(\d+), (\d+)\], full: \[(\d+), (\d+)\], v: "([0-9a-f]+)" \}'
)


def built_copies(needed: set[str]) -> dict[str, tuple[dict[str, tuple[int, int]], str, dict[str, bytes]]]:
    """
    For each key in `needed` (photos whose original isn't in the folder): the copies
    src/lib/historyPhotos.ts records, provided their three files are still exactly those (their
    hash equals the recorded `v`): their sizes, `v` and bytes. Exits, writing nothing, when a needed
    photo has no recorded copy or its files differ. Rows of photos being rebuilt aren't looked at.
    """
    rows = {m.group(1): m for m in MANIFEST_ROW.finditer(MANIFEST.read_text(encoding="utf-8"))} if MANIFEST.exists() else {}
    out: dict[str, tuple[dict[str, tuple[int, int]], str, dict[str, bytes]]] = {}
    problems: list[str] = []
    for key in sorted(needed):
        m = rows.get(key)
        if m is None:
            stem = dict(PHOTOS)[key]
            problems.append(f"missing: {stem} (.jpg / .jpeg / .png / .webp), and no built copy recorded to keep")
            continue
        v = m.group(8)
        nums = [int(x) for x in m.groups()[1:7]]
        sizes = {"960": (nums[0], nums[1]), "1280": (nums[2], nums[3]), "full": (nums[4], nums[5])}
        digest = hashlib.sha256()
        data: dict[str, bytes] = {}
        for label in ("960", "1280", "full"):
            path = OUT_DIR / f"{key}-{label}.webp"
            if not path.exists():
                problems.append(f"{key}: {path.name} is missing")
                break
            data[f"{key}-{label}.webp"] = path.read_bytes()
            digest.update(data[f"{key}-{label}.webp"])
        else:
            if digest.hexdigest()[:10] != v:
                problems.append(f"{key}: its files no longer match the recorded hash {v}")
            else:
                out[key] = (sizes, v, data)
    if problems:
        sys.exit("Nothing written (--keep-built only keeps copies exactly as built).\n  " + "\n  ".join(problems))
    return out


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--keep-built"]
    keep = "--keep-built" in sys.argv[1:]
    if len(args) != 1:
        sys.exit(__doc__)
    if not (features.check("webp") and features.check("littlecms2")):
        sys.exit("This Pillow build lacks WebP or LittleCMS support.")
    folder = Path(args[0])
    if not folder.is_dir():
        sys.exit(f"Not a folder: {folder}")

    originals = find_originals(folder, allow_missing=keep)
    kept = built_copies({key for key, _ in PHOTOS if key not in originals}) if keep else {}
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))

    # Everything is made and checked in memory first, so a failure leaves the repo as it was.
    files: dict[str, bytes] = {}
    rows: list[tuple[str, dict[str, tuple[int, int]], str]] = []
    totals: dict[str, int] = {}
    failures: list[str] = []
    print(f"{'photo':8} {'original':>11}  {'960':>14} {'1280':>14} {'full':>16}  min PSNR luma / RGB  profile")
    for key, _ in PHOTOS:
        if key not in originals:
            # --keep-built: the copies already built, unchanged (checked against their hash).
            sizes, v, data = kept[key]
            files.update(data)
            rows.append((key, sizes, v))
            for label, name in (("960", f"{key}-960.webp"), ("1280", f"{key}-1280.webp"), ("full", f"{key}-full.webp")):
                totals[label] = totals.get(label, 0) + len(data[name])
            print(f"{key:8} {'(kept)':>11}  as built, v {v}", flush=True)
            continue
        im, note = load_upright_srgb(originals[key], srgb)
        width, height = im.size
        targets: dict[str, tuple[int, int, int]] = {}
        # Never larger than the original: a smaller one gives copies at its own size.
        for w in PAGE_WIDTHS:
            pw = min(w, width)
            targets[str(w)] = (pw, round(height * pw / width), PAGE_QUALITY)
        long_edge = min(FULL_LONG_EDGE, max(width, height))
        if width >= height:
            targets["full"] = (long_edge, round(height * long_edge / width), FULL_QUALITY)
        else:
            targets["full"] = (round(width * long_edge / height), long_edge, FULL_QUALITY)

        sizes: dict[str, tuple[int, int]] = {}
        digest = hashlib.sha256()
        cells: list[str] = []
        worst_luma = worst_rgb = math.inf
        for label, (w, h, quality) in targets.items():
            if w > width:
                failures.append(f"{key}-{label}: the original ({width}x{height}) is smaller than {w} px wide")
            # Whole frame: the copy's height must be the original's aspect to within 1 px.
            if abs(h - height * w / width) > 1 or abs(w - width * h / height) > 1:
                failures.append(f"{key}-{label}: {w}x{h} is not the original's aspect ratio ({width}x{height})")
            resized = im.resize((w, h), Image.LANCZOS)
            data = encode(resized, quality)
            back = Image.open(io.BytesIO(data))
            back.load()
            if back.size != (w, h):
                failures.append(f"{key}-{label}: encoded as {back.size[0]}x{back.size[1]}, expected {w}x{h}")
            back = back.convert("RGB")
            luma, rgb = psnr(resized.convert("L"), back.convert("L")), psnr(resized, back)
            worst_luma, worst_rgb = min(worst_luma, luma), min(worst_rgb, rgb)
            if luma < MIN_LUMA_PSNR_DB:
                failures.append(f"{key}-{label}: {luma:.1f} dB luma PSNR, under {MIN_LUMA_PSNR_DB:.0f}")
            if rgb < MIN_RGB_PSNR_DB:
                failures.append(f"{key}-{label}: {rgb:.1f} dB RGB PSNR, under {MIN_RGB_PSNR_DB:.0f}")
            files[f"{key}-{label}.webp"] = data
            sizes[label] = (w, h)
            digest.update(data)
            totals[label] = totals.get(label, 0) + len(data)
            cells.append(f"{w}x{h} {len(data) // 1024}K")
        rows.append((key, sizes, digest.hexdigest()[:10]))
        print(
            f"{key:8} {f'{width}x{height}':>11}  {cells[0]:>14} {cells[1]:>14} {cells[2]:>16}  "
            f"{worst_luma:8.1f} / {worst_rgb:4.1f} dB  {note}",
            flush=True,
        )

    if failures:
        sys.exit("Nothing written.\n  " + "\n  ".join(failures))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # A file whose bytes don't change (every kept copy) is left alone; the others are written to a
    # temporary file and moved into place, so no copy is ever left half-written. Stale files go last.
    for name, data in files.items():
        path = OUT_DIR / name
        if path.exists() and path.read_bytes() == data:
            continue
        tmp = path.with_name(name + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)

    lines = [
        "// Generated by scripts/build-history-photos.py; regenerate, don't hand-edit.",
        "// The web copies of the Edison Mandir History photographs (public/history/photos/): each",
        "// copy's pixel size ([width, height]; every copy is the whole frame of its original) and",
        "// `v`, a hash of the three files, which goes in their URLs so they can be cached for good.",
        "",
        "export type HistoryPhotoFile = {",
        "  /** `<key>-960.webp`: 960 px wide, or the original's width when that is smaller. */",
        "  w960: readonly [number, number];",
        "  /** `<key>-1280.webp`: 1280 px wide, or the original's width when that is smaller. */",
        "  w1280: readonly [number, number];",
        f"  /** `<key>-full.webp`: {FULL_LONG_EDGE} px on its long edge, or the original's size when smaller (the viewer's copy). */",
        "  full: readonly [number, number];",
        "  v: string;",
        "};",
        "",
        "export const HISTORY_PHOTO_FILES = {",
    ]
    for key, sizes, v in rows:
        w960, w1280, full = sizes["960"], sizes["1280"], sizes["full"]
        lines.append(
            f'  "{key}": {{ w960: [{w960[0]}, {w960[1]}], w1280: [{w1280[0]}, {w1280[1]}], '
            f'full: [{full[0]}, {full[1]}], v: "{v}" }},'
        )
    lines += [
        "} as const satisfies Record<string, HistoryPhotoFile>;",
        "",
        "export type HistoryPhotoKey = keyof typeof HISTORY_PHOTO_FILES;",
        "",
    ]
    MANIFEST.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    for stale in OUT_DIR.glob("*.webp"):
        if stale.name not in files:
            stale.unlink()

    total = sum(totals.values())
    print(
        f"\n{len(files)} files in {OUT_DIR.relative_to(REPO).as_posix()}: "
        + ", ".join(f"{label} set {size / 1048576:.1f} MB" for label, size in totals.items())
        + f", {total / 1048576:.1f} MB in all."
    )
    print(f"Wrote {MANIFEST.relative_to(REPO).as_posix()}.")


if __name__ == "__main__":
    main()

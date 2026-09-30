#!/usr/bin/env python3
"""Prepare the opt-in 3D intro's CC0 maps. Requires Pillow; originals stay in ignored tools/raw/.

    python3 site/tools/build_real_textures.py

Sources and original-file checksums are in real-textures.json. Download with curl's system CA
store, cache verified originals, then encode local WebP maps. No remote requests at runtime.
"""
import hashlib
import json
import subprocess
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parent
RAW = TOOLS / "raw/real-textures"
OUT = TOOLS.parent / "assets/textures/real"


def source(item):
    path = RAW / item["file"]
    if not path.exists():
        subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location",
                        "--output", str(path), "https://dl.polyhaven.org/file/ph-assets/" + item["remote"]], check=True)
    if hashlib.md5(path.read_bytes()).hexdigest() != item["md5"]:
        raise ValueError(f"Source checksum mismatch: {path}")


def encode(name, image, size=None, **options):
    if size:
        image = image.resize((size, size), Image.Resampling.LANCZOS)
    path = OUT / (name + ".webp")
    image.save(path, "WEBP", method=6, **options)
    print(name, image.size, f"{path.stat().st_size / 1024:.1f} KiB")


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((TOOLS / "real-textures.json").read_text())
    for entry in manifest["sources"]:
        for item in entry["maps"]:
            source(item)
    read = lambda name: Image.open(RAW / name).convert("RGB")
    encode("floor-color", read("floor-diff.jpg"), quality=75)
    # Vector/data maps remain linear at runtime. A smaller normal map avoids carrying detail
    # finer than the opening camera can resolve; lossless ARM preserves its packed channels.
    encode("floor-normal", read("floor-normal.jpg"), 512, quality=90)
    encode("floor-arm", read("floor-arm.jpg"), 256, lossless=True)


if __name__ == "__main__":
    main()

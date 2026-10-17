#!/usr/bin/env python3
"""
LiveSub Extension Packaging & Validation Script
Builds and packages the Chrome Manifest V3 extension into dist/livesub-extension.zip
ensuring manifest.json is directly at the root of the zip archive.
"""

import os
import sys
import shutil
import zipfile
import subprocess
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
EXTENSION_DIR = ROOT_DIR / "extension"
BUILD_DIR = EXTENSION_DIR / ".output" / "chrome-mv3"
DIST_DIR = ROOT_DIR / "dist"
ZIP_PATH = DIST_DIR / "livesub-extension.zip"


def run_command(cmd, cwd):
    print(f"[package] Running: {' '.join(cmd)} in {cwd}")
    res = subprocess.run(cmd, cwd=cwd, shell=True)
    if res.returncode != 0:
        print(f"[package] Error: command failed with return code {res.returncode}")
        sys.exit(res.returncode)


def main():
    print("=" * 60)
    print(" LiveSub Browser Extension Packager")
    print("=" * 60)

    # 1. Build the production extension using WXT
    print("\n[Step 1] Building production extension via WXT...")
    run_command(["npm", "run", "build"], cwd=EXTENSION_DIR)

    # 2. Verify build directory and manifest.json
    print("\n[Step 2] Verifying build output...")
    if not BUILD_DIR.exists():
        print(f"[package] Error: Build directory does not exist: {BUILD_DIR}")
        sys.exit(1)

    manifest_file = BUILD_DIR / "manifest.json"
    if not manifest_file.exists():
        print(f"[package] Error: manifest.json not found in build directory: {manifest_file}")
        sys.exit(1)
    print(f" [OK] manifest.json confirmed at: {manifest_file}")

    # 3. Create dist directory
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    # 4. Create ZIP archive with manifest.json at the root
    print(f"\n[Step 3] Creating ZIP archive at: {ZIP_PATH} ...")
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()

    total_files = 0
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(BUILD_DIR):
            for file in files:
                file_path = Path(root) / file
                # arcname must be relative to BUILD_DIR so manifest.json is at archive root
                arcname = file_path.relative_to(BUILD_DIR).as_posix()
                zf.write(file_path, arcname=arcname)
                total_files += 1

    file_size_bytes = ZIP_PATH.stat().st_size
    file_size_kb = file_size_bytes / 1024.0
    print(f" [OK] Successfully packaged {total_files} files ({file_size_kb:.2f} KB)")

    # 5. Validate the ZIP archive
    print("\n[Step 4] Validating ZIP structure & manifest root location...")
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        namelist = zf.namelist()
        if "manifest.json" not in namelist:
            print("[package] ERROR: manifest.json is NOT at the root of the ZIP archive!")
            sys.exit(1)
        print(" [OK] Verified: manifest.json is directly at the root of the ZIP archive.")

        # Ensure no accidental secrets
        for name in namelist:
            if ".env" in name or "node_modules" in name or ".git" in name:
                print(f"[package] WARNING: Suspicious file found in zip: {name}")

    # 6. Test extracting to a temporary folder
    print("\n[Step 5] Simulating Chrome 'Load unpacked' folder extraction...")
    with tempfile.TemporaryDirectory() as tmp_dir:
        with zipfile.ZipFile(ZIP_PATH, "r") as zf:
            zf.extractall(tmp_dir)

        extracted_manifest = Path(tmp_dir) / "manifest.json"
        if not extracted_manifest.exists():
            print("[package] ERROR: Extraction validation failed. manifest.json not in top-level directory!")
            sys.exit(1)
        print(" [OK] Verified: Extracted top-level folder contains manifest.json directly.")

    print("\n" + "=" * 60)
    print(" Extension ZIP is READY for hackathon submission!")
    print(f" Path: {ZIP_PATH}")
    print(f" Size: {file_size_kb:.2f} KB ({file_size_bytes} bytes)")
    print("=" * 60)


if __name__ == "__main__":
    main()

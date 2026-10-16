"""
Download Shrutam-2 model weights from Hugging Face Hub into local cache.
Supports automatic resumption if interrupted.
"""
import sys
import time
from huggingface_hub import snapshot_download

REPO_ID = "bharatgenai/Shrutam-2"

def main():
    print(f"[{time.strftime('%X')}] Starting download of {REPO_ID} weights (~7.6 GB)...")
    try:
        path = snapshot_download(
            repo_id=REPO_ID,
            resume_download=True,
            max_workers=4,
        )
        print(f"[{time.strftime('%X')}] Successfully downloaded {REPO_ID} to: {path}")
    except Exception as e:
        print(f"[{time.strftime('%X')}] Download error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

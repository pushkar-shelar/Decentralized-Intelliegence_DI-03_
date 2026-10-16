import os
import sys
import uvicorn

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

if __name__ == "__main__":
    print("[LiveSub Backend] Starting on http://127.0.0.1:8765 ...")
    uvicorn.run(
        "backend.app.main:app",
        host="127.0.0.1",
        port=8765,
        reload=False,
        log_level="info",
    )

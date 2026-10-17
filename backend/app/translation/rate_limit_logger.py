import os
import time
from typing import Optional

# Path to rate_limiting.txt in the root directory (d:\LiveSub\rate_limiting.txt)
RATE_LIMIT_LOG_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "rate_limiting.txt")
)

def log_rate_limit(service: str, message: str, status_code: Optional[int] = None) -> None:
    """
    Appends a timestamped rate-limiting notification to rate_limiting.txt in the project root directory.
    Format:
    [YYYY-MM-DD HH:MM:SS] [SERVICE_NAME] Rate limit exceeded (HTTP 429): <message>
    """
    try:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        status_part = f" (HTTP {status_code})" if status_code else ""
        clean_msg = message.strip().replace("\r", " ").replace("\n", " ")
        log_line = f"[{timestamp}] [{service}] Rate limit exceeded{status_part}: {clean_msg}\n"

        # If file does not exist yet or is empty, write a descriptive header
        needs_header = not os.path.exists(RATE_LIMIT_LOG_FILE) or os.path.getsize(RATE_LIMIT_LOG_FILE) == 0

        with open(RATE_LIMIT_LOG_FILE, "a", encoding="utf-8") as f:
            if needs_header:
                f.write("================================================================================\n")
                f.write("LiveSub API Rate Limiting Event Log\n")
                f.write("================================================================================\n")
            f.write(log_line)
            f.flush()

        print(f"[RateLimitLogger] Logged rate limit event to rate_limiting.txt: {log_line.strip()}")
    except Exception as e:
        print(f"[RateLimitLogger] Failed to write to {RATE_LIMIT_LOG_FILE}: {e}")

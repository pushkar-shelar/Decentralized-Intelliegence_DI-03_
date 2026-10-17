import os
import time
from typing import Optional

# Path to the root whispr_logs.txt
LOG_FILE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "whispr_logs.txt")
)

def start_new_log_run(run_title: str = "Whisper / WhisperX STT Run"):
    """
    Appends a distinct horizontal separator line and header timestamp
    to whispr_logs.txt to mark the beginning of a new transcription run.
    """
    try:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        separator = "--------------------------------------------------------------------------------"
        with open(LOG_FILE_PATH, "a", encoding="utf-8") as f:
            f.write(f"\n{separator}\n")
            f.write(f"=== {run_title} | Started at: {timestamp} ===\n")
            f.write(f"{separator}\n")
    except Exception as e:
        print(f"[WhisperLogger] Failed to write run header: {e}")

def log_stt_output(
    text: str,
    start: Optional[float] = None,
    end: Optional[float] = None,
    language: Optional[str] = None,
    speaker: Optional[str] = None,
    source: str = "WhisperX STT",
    status: str = "FINAL",
):
    """
    Appends a single STT transcription output event to whispr_logs.txt on a new line.
    """
    try:
        timestamp = time.strftime("%H:%M:%S")
        time_part = f"[{start:.2f}s -> {end:.2f}s]" if (start is not None and end is not None) else ""
        spk_part = f" [{speaker}]" if speaker else ""
        lang_part = f" [{language}]" if language else ""
        clean_text = text.strip()

        line = f"[{timestamp}] [{status}] [{source}]{lang_part}{spk_part} {time_part}: {clean_text}\n"
        with open(LOG_FILE_PATH, "a", encoding="utf-8") as f:
            f.write(line)
            f.flush()
    except Exception as e:
        print(f"[WhisperLogger] Failed to append STT log: {e}")

import os
import tempfile
import pytest
from backend.app.translation.rate_limit_logger import log_rate_limit, RATE_LIMIT_LOG_FILE

def test_rate_limit_logger_appends_timestamp_and_message():
    assert RATE_LIMIT_LOG_FILE.endswith("rate_limiting.txt")
    test_msg = "Too Many Requests - limit: 30000 TPM"
    log_rate_limit("PyTest Service", test_msg, status_code=429)

    assert os.path.exists(RATE_LIMIT_LOG_FILE)
    with open(RATE_LIMIT_LOG_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    assert "PyTest Service" in content
    assert "Rate limit exceeded (HTTP 429)" in content
    assert test_msg in content

import json
import numpy as np
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["backend"] == "LiveSub"
    assert data["shrutam_model_available"] is True
    assert "models\\shrutam-2" in data["shrutam_model_dir"] or "models/shrutam-2" in data["shrutam_model_dir"]

def test_audio_websocket_streaming():
    with client.websocket_connect("/api/ws/audio") as websocket:
        # 1. Send chunk metadata
        meta = {
            "type": "chunk_meta",
            "perfNow": 12345.6,
            "durationMs": 200.0,
            "anchor": {
                "perfNow": 12300.0,
                "videoTime": 14.2,
                "rate": 1.0,
                "paused": False,
            },
        }
        websocket.send_text(json.dumps(meta))

        # 2. Generate 3200 samples of 1kHz sine wave @ 16kHz (200ms of audio)
        t = np.linspace(0, 0.2, 3200, endpoint=False)
        sine = (np.sin(2 * np.pi * 1000 * t) * 32767).astype(np.int16)
        raw_bytes = sine.tobytes()

        # Send binary frame
        websocket.send_bytes(raw_bytes)

        # Receive telemetry ack
        ack_text = websocket.receive_text()
        ack = json.loads(ack_text)

        assert ack["type"] == "audio_ack"
        assert ack["chunk_index"] == 1
        assert ack["samples"] == 3200
        # Sine wave RMS is around -3 dBFS
        assert -6.0 < ack["rms_db"] < 0.0

import os
import json
import time
import math
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="LiveSub Backend", description="Real-time speech recognition & translation server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "models", "shrutam-2")

@app.get("/api/health")
def health_check():
    has_shrutam = os.path.isdir(MODEL_DIR) and os.path.exists(os.path.join(MODEL_DIR, "config.json"))
    return {
        "status": "ok",
        "backend": "LiveSub",
        "timestamp": time.time(),
        "shrutam_model_available": has_shrutam,
        "shrutam_model_dir": MODEL_DIR if has_shrutam else None,
    }

@app.websocket("/api/ws/audio")
async def audio_websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("[LiveSub WS] Audio client connected from extension")
    chunk_count = 0
    total_samples = 0
    latest_meta = {}

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                chunk_bytes = message["bytes"]
                chunk_count += 1
                
                # Convert 16-bit PCM bytes to numpy array
                samples = np.frombuffer(chunk_bytes, dtype=np.int16)
                num_samples = len(samples)
                total_samples += num_samples
                duration_ms = (num_samples / 16000.0) * 1000.0

                # Compute RMS audio energy
                norm = samples / 32768.0
                rms = float(np.sqrt(np.mean(norm ** 2)))
                db = float(20 * math.log10(rms + 1e-9))

                # Log periodic telemetry (every 10 chunks ~ 2 seconds)
                if chunk_count % 10 == 1:
                    anchor = latest_meta.get("anchor", {})
                    v_time = anchor.get("videoTime", 0)
                    rate = anchor.get("rate", 1.0)
                    print(
                        f"[LiveSub WS] Chunk #{chunk_count:04d} | {num_samples} samples ({duration_ms:.0f}ms) | "
                        f"RMS: {db:.1f} dBFS | Video time: {v_time:.2f}s ({rate}x)"
                    )

                # Send telemetry ack back to client
                await websocket.send_text(
                    json.dumps({
                        "type": "audio_ack",
                        "chunk_index": chunk_count,
                        "samples": num_samples,
                        "rms_db": round(db, 2),
                        "total_seconds": round(total_samples / 16000.0, 2),
                    })
                )

            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    if data.get("type") == "chunk_meta":
                        latest_meta = data
                except Exception:
                    pass

    except WebSocketDisconnect:
        print(f"[LiveSub WS] Audio client disconnected. Total chunks received: {chunk_count}")
    except Exception as e:
        print(f"[LiveSub WS] Error in websocket loop: {e}")

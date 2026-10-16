import os
import json
import time
import math
from contextlib import asynccontextmanager
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.app.models.shrutam_engine import ShrutamEngine
from backend.app.models.whisper_engine import WhisperEngine
from backend.app.audio.vad import SileroVAD
from backend.app.services.streaming_processor import StreamingSpeechProcessor

# Global model references
shrutam_engine = None
whisper_engine = None
silero_vad = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global shrutam_engine, whisper_engine, silero_vad
    print("[LiveSub Backend] Initializing models and VAD...")

    # Load Silero VAD
    silero_vad = SileroVAD()

    # Load Shrutam-2 from local project folder
    try:
        shrutam_engine = ShrutamEngine()
    except Exception as e:
        print(f"[LiveSub Backend] Warning: ShrutamEngine init deferred ({e})")

    # Load Whisper Turbo
    try:
        whisper_engine = WhisperEngine(model_size="large-v3-turbo")
    except Exception as e:
        print(f"[LiveSub Backend] Warning: WhisperEngine init deferred ({e})")

    yield

    print("[LiveSub Backend] Shutting down...")

app = FastAPI(
    title="LiveSub Backend",
    description="Real-time speech recognition & translation server",
    version="0.1.0",
    lifespan=lifespan,
)

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
        "shrutam_loaded": shrutam_engine.is_ready() if shrutam_engine else False,
        "whisper_loaded": whisper_engine.is_ready() if whisper_engine else False,
    }

@app.websocket("/api/ws/audio")
async def audio_websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("[LiveSub WS] Audio client connected from extension")

    processor = StreamingSpeechProcessor(
        shrutam=shrutam_engine,
        whisper=whisper_engine,
        vad=silero_vad,
    )

    chunk_count = 0
    total_samples = 0
    latest_meta = {}
    preferred_lang = "auto"

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                chunk_bytes = message["bytes"]
                chunk_count += 1

                samples = np.frombuffer(chunk_bytes, dtype=np.int16)
                num_samples = len(samples)
                total_samples += num_samples

                rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2))) if num_samples > 0 else 0.0
                rms_db = float(20 * np.log10(rms / 32768.0)) if rms > 1e-5 else -90.0

                anchor = latest_meta.get("anchor", {})
                perf_now = latest_meta.get("perfNow", time.time() * 1000)

                # Process chunk through VAD and speech models
                cue = processor.process_chunk(
                    chunk_pcm_int16=samples,
                    perf_now=perf_now,
                    anchor=anchor,
                    preferred_lang=preferred_lang,
                )

                if cue:
                    status_str = "FINAL" if cue.get("is_final") else "PARTIAL"
                    print(f"[LiveSub WS] {status_str} Cue [{cue['lang']}]: {cue['text']}")
                    await websocket.send_text(
                        json.dumps({
                            "type": "cue_update",
                            "cue": cue,
                        })
                    )
                else:
                    # Periodic ack
                    if chunk_count % 10 == 1:
                        await websocket.send_text(
                            json.dumps({
                                "type": "audio_ack",
                                "chunk_index": chunk_count,
                                "samples": num_samples,
                                "rms_db": round(rms_db, 2),
                            })
                        )

            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    if data.get("type") == "chunk_meta":
                        latest_meta = data
                    elif data.get("type") == "config":
                        preferred_lang = data.get("language", "auto")
                except Exception:
                    pass

    except WebSocketDisconnect:
        print(f"[LiveSub WS] Audio client disconnected. Total chunks processed: {chunk_count}")
    except Exception as e:
        print(f"[LiveSub WS] Error in websocket loop: {e}")

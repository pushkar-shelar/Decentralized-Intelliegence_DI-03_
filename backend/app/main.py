import os
# Force PyTorch-only backend in transformers and avoid protobuf conflicts with tensorflow
os.environ["USE_TF"] = "0"
os.environ["TRANSFORMERS_NO_TF"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

import json
import time
import math
from contextlib import asynccontextmanager
import numpy as np
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"))

from backend.app.models.shrutam_engine import ShrutamEngine
from backend.app.models.whisper_engine import WhisperEngine
from backend.app.models.whisperx_engine import WhisperXEngine
from backend.app.audio.vad import SileroVAD
from backend.app.services.streaming_processor import StreamingSpeechProcessor
from backend.app.services.stream_resolver import StreamResolver
from backend.app.translation.unified_translator import UnifiedTranslator

# Global model references
shrutam_engine = None
whisper_engine = None
whisperx_engine = None
silero_vad = None
stream_resolver = None
unified_translator = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global shrutam_engine, whisper_engine, silero_vad, stream_resolver, unified_translator
    print("[LiveSub Backend] Initializing models and VAD...")

    # Load Silero VAD
    silero_vad = SileroVAD()

    # Load StreamResolver
    stream_resolver = StreamResolver()

    # Load UnifiedTranslator (Grok primary -> Sarvam fallback)
    unified_translator = UnifiedTranslator()

    # Shrutam-2 deprecated in favor of Whisper large-v3-turbo with language='hi'
    shrutam_engine = None

    # Load Whisper Turbo
    try:
        whisper_engine = WhisperEngine(model_size="large-v3-turbo")
    except Exception as e:
        print(f"[LiveSub Backend] Warning: WhisperEngine init deferred ({e})")

    # Load WhisperX Engine
    try:
        whisperx_engine = WhisperXEngine(model_size="large-v3-turbo")
    except Exception as e:
        print(f"[LiveSub Backend] Warning: WhisperXEngine init deferred ({e})")

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
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "models", "shrutam-2")

@app.get("/")
def root():
    return {
        "status": "ok",
        "backend": "LiveSub",
        "health": "/api/health",
        "docs": "/docs",
    }

@app.get("/api/ws/audio")
def ws_audio_info():
    return {
        "endpoint": "/api/ws/audio",
        "protocol": "WebSocket",
        "message": "This endpoint requires a WebSocket connection (ws://localhost:8765/api/ws/audio), used automatically by the LiveSub Chrome extension.",
    }

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
        "grok_configured": bool(unified_translator and unified_translator.grok_api_key),
        "sarvam_configured": bool(unified_translator and unified_translator.sarvam_api_key),
    }

from pydantic import BaseModel

class PreProcessRequest(BaseModel):
    video_id: str
    target_lang: Optional[str] = "en"
    source_lang: Optional[str] = "auto"
    start_sec: Optional[float] = 0.0
    duration_sec: Optional[float] = 120.0

@app.post("/api/video/pre-process")
async def preprocess_video(req: PreProcessRequest):
    """
    Downloads the video's audio track in background via yt-dlp,
    rapidly transcribes with word-level timestamps via Whisper,
    and translates idioms via Sarvam Mayura.
    Returns array of pre-buffered cues for 0ms subtitle playback.
    """
    if not stream_resolver:
        return {"ok": False, "error": "StreamResolver not initialized"}

    print(f"[PreProcess] Request received for video {req.video_id} (from {req.start_sec}s for {req.duration_sec}s)")
    try:
        # 1. Fetch audio stream file
        wav_path = stream_resolver.fetch_video_audio(req.video_id)

        # 2. Load audio segment
        audio_chunk = stream_resolver.load_audio_segment(
            wav_path,
            start_sec=req.start_sec or 0.0,
            duration_sec=req.duration_sec or 120.0,
        )

        if len(audio_chunk) == 0:
            return {"ok": True, "cues": []}

        # 3. Fast transcription with word-level boundaries and optional diarization
        cues = []
        segments = []
        detected_lang = req.source_lang or "en"

        if whisperx_engine and whisperx_engine.is_ready():
            try:
                wx_segs = whisperx_engine.process_audio(
                    audio_chunk,
                    language=req.source_lang if req.source_lang != "auto" else None,
                    enable_diarization=True,
                )
                if wx_segs and len(wx_segs) > 0:
                    segments = wx_segs
                    detected_lang = wx_segs[0].get("language", detected_lang)
            except Exception as e:
                print(f"[PreProcess] WhisperX failed, falling back to WhisperEngine: {e}")

        # Fallback to standard WhisperEngine with word_timestamps
        if len(segments) == 0 and whisper_engine and whisper_engine.is_ready():
            res = whisper_engine.transcribe(
                audio_chunk,
                language=req.source_lang if req.source_lang != "auto" else None,
                is_final=True,
            )
            detected_lang = res.language or detected_lang
            for s in res.segments:
                segments.append({
                    "start": s.start,
                    "end": s.end,
                    "text": s.text,
                    "speaker": None,
                })

        # 4. Translate segments via UnifiedTranslator (Grok -> Sarvam)
        base_offset = req.start_sec or 0.0
        for idx, seg in enumerate(segments):
            text = seg["text"].strip()
            if not text:
                continue

            abs_start = round(base_offset + seg["start"], 3)
            abs_end = round(base_offset + seg["end"], 3)

            translation = None
            if unified_translator and req.target_lang:
                translation = await unified_translator.translate(
                    text=text,
                    source_lang=detected_lang or "hi",
                    target_lang=req.target_lang,
                )

            cues.append({
                "id": f"pre-{req.video_id}-{idx}-{abs_start}",
                "start": abs_start,
                "end": abs_end,
                "text": text,
                "translation": translation,
                "speaker": seg.get("speaker"),
                "lang": detected_lang or "en",
                "translation_lang": req.target_lang or "en",
                "source": "pre-process",
                "is_final": True,
                "first_shown_at": None,
                "revisions": [{"at": abs_start, "text": text}],
            })

        return {"ok": True, "video_id": req.video_id, "cues": cues}
    except Exception as e:
        print(f"[PreProcess] Error: {e}")
        return {"ok": False, "error": str(e)}


@app.websocket("/api/ws/audio")
async def audio_websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("[LiveSub WS] Audio client connected from extension", flush=True)

    processor = StreamingSpeechProcessor(
        shrutam=shrutam_engine,
        whisper=whisper_engine,
        vad=silero_vad,
    )

    chunk_count = 0
    total_samples = 0
    latest_meta = {}
    preferred_lang = "auto"
    target_lang = "en"

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
                    
                    # If cue text is ready and unified_translator is available, translate via Grok -> Sarvam
                    cue_lang = cue.get("lang") or preferred_lang or "hi"
                    if unified_translator and target_lang and cue.get("text") and cue.get("is_final"):
                        if cue_lang.lower() != target_lang.lower():
                            try:
                                translation = await unified_translator.translate(
                                    text=cue["text"],
                                    source_lang=cue_lang,
                                    target_lang=target_lang,
                                )
                                cue["translation"] = translation
                                cue["translation_lang"] = target_lang
                            except Exception as e:
                                print(f"[LiveSub WS] Translation error: {e}")

                    log_msg = f"[LiveSub WS] {status_str} Cue [{cue.get('lang', 'hi')}]: {cue['text']}"
                    if cue.get("translation"):
                        log_msg += f" --> [{cue.get('translation_lang', 'en')}]: {cue['translation']}"
                    print(log_msg, flush=True)

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
                        if data.get("sourceLang"):
                            preferred_lang = data.get("sourceLang")
                        if data.get("targetLang"):
                            target_lang = data.get("targetLang")
                    elif data.get("type") == "config":
                        if data.get("language"):
                            preferred_lang = data.get("language")
                        if data.get("target_lang"):
                            target_lang = data.get("target_lang")
                except Exception:
                    pass

    except WebSocketDisconnect:
        print(f"[LiveSub WS] Audio client disconnected. Total chunks processed: {chunk_count}")
    except Exception as e:
        print(f"[LiveSub WS] Error in websocket loop: {e}")

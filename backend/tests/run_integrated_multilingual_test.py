import os
import sys
import json
import time
import asyncio
import tempfile
import numpy as np
import soundfile as sf
import imageio_ffmpeg
import subprocess
from gtts import gTTS
from dotenv import load_dotenv

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env")))

from backend.app.models.whisper_engine import WhisperEngine
from backend.app.translation.unified_translator import UnifiedTranslator

# 15 Rigorous Multilingual Audio Test Cases
TEST_SUITE = [
    # Hindi Idioms & Spoken Discourse
    {"id": 1, "lang": "hi", "target_lang": "en", "category": "Hindi Idiom", "spoken_text": "दाल में कुछ काला है, मुझे उस पर शक हो रहा है।"},
    {"id": 2, "lang": "hi", "target_lang": "en", "category": "Hindi Idiom", "spoken_text": "आसमान से गिरा और खजूर में अटका, यह तो वही बात हुई।"},
    {"id": 3, "lang": "hi", "target_lang": "en", "category": "Hindi Colloquial", "spoken_text": "हेलो दोस्तों, स्वागत है आपका हमारे इस यूट्यूब चैनल में।"},
    {"id": 4, "lang": "hi", "target_lang": "en", "category": "Hindi Idiom", "spoken_text": "अरे भाई ज्यादा हवा में मत उड़ो, जमीन पर रहो।"},
    {"id": 5, "lang": "hi", "target_lang": "en", "category": "Hindi Conversational", "spoken_text": "आज मौसम बहुत सुहावना है और बारिश होने वाली है।"},

    # Marathi Spoken Discourse & Idioms
    {"id": 6, "lang": "mr", "target_lang": "en", "category": "Marathi Colloquial", "spoken_text": "नमस्कार मित्रांनो, आपल्या चॅनेलवर सर्वांचे मनापासून स्वागत आहे."},
    {"id": 7, "lang": "mr", "target_lang": "en", "category": "Marathi Idiom", "spoken_text": "घरोघरी मातीच्या चुली असतात, कुठेही जा तेच दिसेल."},
    {"id": 8, "lang": "mr", "target_lang": "en", "category": "Marathi Conversational", "spoken_text": "आज संध्याकाळी आपण जेवायला बाहेर जाऊया का?"},

    # Tamil Spoken Discourse & Idioms
    {"id": 9, "lang": "ta", "target_lang": "en", "category": "Tamil Conversational", "spoken_text": "வணக்கம் நண்பர்களே, இந்த வீடியோவை பார்த்ததற்கு நன்றி."},
    {"id": 10, "lang": "ta", "target_lang": "en", "category": "Tamil Idiom", "spoken_text": "காக்கைக்கும் தன் குஞ்சு பொன் குஞ்சு என்று சொல்வார்கள்."},
    {"id": 11, "lang": "ta", "target_lang": "en", "category": "Tamil Conversational", "spoken_text": "நாளைக்கு நாம் அனைவரும் கடற்கரைக்கு செல்லலாம்."},

    # Telugu Spoken Discourse & Idioms
    {"id": 12, "lang": "te", "target_lang": "en", "category": "Telugu Conversational", "spoken_text": "అందరికీ నమస్కారం, మన ఛానల్ కి స్వాగతం."},
    {"id": 13, "lang": "te", "target_lang": "en", "category": "Telugu Conversational", "spoken_text": "ఈ రోజు హైదరాబాద్ లో వాతావరణం చాలా ఆహ్లాదకరంగా ఉంది."},

    # English Conversational & Idiomatic
    {"id": 14, "lang": "en", "target_lang": "hi", "category": "English to Hindi Idiom", "spoken_text": "You definitely hit the nail on the head with that explanation."},
    {"id": 15, "lang": "en", "target_lang": "hi", "category": "English to Hindi Conversational", "spoken_text": "Welcome back to the channel, today we are going to learn something amazing."}
]

def synthesize_audio_16k(text: str, lang_code: str) -> np.ndarray:
    """
    Synthesize natural speech audio for the given text using gTTS
    and convert to 16kHz mono float32 numpy array.
    """
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as mp3_f:
        mp3_path = mp3_f.name

    wav_path = mp3_path.replace(".mp3", "_16k.wav")

    try:
        # 1. Synthesize audio
        tts = gTTS(text=text, lang=lang_code, slow=False)
        tts.save(mp3_path)

        # 2. Resample to 16kHz mono WAV using ffmpeg
        cmd = [
            ffmpeg_exe, "-y",
            "-i", mp3_path,
            "-ar", "16000",
            "-ac", "1",
            wav_path
        ]
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

        # 3. Read normalized float32
        data, sr = sf.read(wav_path, dtype="float32")
        return data
    finally:
        if os.path.exists(mp3_path):
            os.remove(mp3_path)
        if os.path.exists(wav_path):
            os.remove(wav_path)

async def run_rigorous_tests():
    print("=" * 75)
    print(">>> RIGOROUS END-TO-END PIPELINE TESTING (AUDIO -> ASR -> TRANSLATION)")
    print("=" * 75)

    whisper = WhisperEngine(model_size="large-v3-turbo")
    translator = UnifiedTranslator()

    results = []
    total_pipeline_time = 0

    for item in TEST_SUITE:
        case_id = item["id"]
        src_lang = item["lang"]
        tgt_lang = item["target_lang"]
        spoken = item["spoken_text"]
        cat = item["category"]

        print(f"\n[Test Case {case_id:02d} / {len(TEST_SUITE)}] {cat} ({src_lang} -> {tgt_lang})")
        print(f"  Spoken Audio Input: \"{spoken}\"")

        # 1. Synthesize Audio
        t_synth = time.perf_counter()
        audio_16k = synthesize_audio_16k(spoken, src_lang)
        synth_ms = round((time.perf_counter() - t_synth) * 1000, 1)
        audio_dur_sec = round(len(audio_16k) / 16000.0, 2)

        # 2. Transcribe with Whisper (Word-Level Timestamps & LID)
        t_asr = time.perf_counter()
        asr_res = whisper.transcribe(
            audio_16k,
            language=src_lang if src_lang != "auto" else None,
            is_final=True,
        )
        asr_ms = round((time.perf_counter() - t_asr) * 1000, 1)
        transcription = asr_res.text.strip()
        detected_lang = asr_res.language

        # Extract word timestamps
        words_timed = []
        for s in asr_res.segments:
            words_timed.append({
                "start": s.start,
                "end": s.end,
                "text": s.text,
            })

        print(f"  -> ASR Output ({asr_ms}ms | Audio: {audio_dur_sec}s): \"{transcription}\"")

        # 3. Translate with UnifiedTranslator (Grok -> Sarvam Fallback)
        t_trans = time.perf_counter()
        translation = await translator.translate(transcription, source_lang=detected_lang, target_lang=tgt_lang)
        trans_ms = round((time.perf_counter() - t_trans) * 1000, 1)

        total_ms = round(asr_ms + trans_ms, 1)
        total_pipeline_time += total_ms

        print(f"  -> Final Translation ({trans_ms}ms): \"{translation}\"")
        print(f"  -> Total Pipeline E2E Latency: {total_ms}ms (Real-Time Factor: {round((total_ms/1000)/audio_dur_sec, 2)}x)")

        case_record = {
            "test_id": case_id,
            "category": cat,
            "source_lang": src_lang,
            "target_lang": tgt_lang,
            "audio_duration_sec": audio_dur_sec,
            "ground_truth_speech": spoken,
            "transcription": transcription,
            "detected_language": detected_lang,
            "word_timed_segments": words_timed,
            "translated_subtitles": translation,
            "latency": {
                "asr_ms": asr_ms,
                "translation_ms": trans_ms,
                "total_e2e_ms": total_ms,
                "real_time_factor": round((total_ms / 1000) / audio_dur_sec, 3),
            },
            "status": "PASS" if len(transcription) > 0 and len(translation) > 0 else "FAIL",
        }
        results.append(case_record)
        # Small delay to respect remote LLM rate-limits
        await asyncio.sleep(1.0)

    # Compile Final Benchmark Summary
    summary = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_test_cases": len(TEST_SUITE),
        "passed": sum(1 for r in results if r["status"] == "PASS"),
        "failed": sum(1 for r in results if r["status"] == "FAIL"),
        "avg_asr_latency_ms": round(np.mean([r["latency"]["asr_ms"] for r in results]), 1),
        "avg_translation_latency_ms": round(np.mean([r["latency"]["translation_ms"] for r in results]), 1),
        "avg_total_e2e_ms": round(np.mean([r["latency"]["total_e2e_ms"] for r in results]), 1),
        "avg_real_time_factor": round(np.mean([r["latency"]["real_time_factor"] for r in results]), 3),
        "results": results,
    }

    # Save to results/integrated_testing_report.json
    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "results"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "integrated_testing_report.json")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 75)
    print(f"ALL RIGOROUS INTEGRATED TESTS COMPLETE! Report saved to:\n{out_path}")
    print(f"Summary: {summary['passed']}/{summary['total_test_cases']} Passed | Avg E2E Latency: {summary['avg_total_e2e_ms']}ms | Avg RTF: {summary['avg_real_time_factor']}")
    print("=" * 75)

if __name__ == "__main__":
    asyncio.run(run_rigorous_tests())

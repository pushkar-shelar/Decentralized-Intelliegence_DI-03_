import os
import sys
import json
import time
import asyncio
import numpy as np
import soundfile as sf
from typing import Dict, Any, List
from dotenv import load_dotenv

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env")))

from backend.app.models.whisper_engine import WhisperEngine
from backend.app.translation.unified_translator import UnifiedTranslator

# Test cases encompassing diverse Indian languages, idioms (muhavre), colloquial phrases, and code-mixed inputs
MULTILINGUAL_TEST_CASES = [
    # 1. Hindi Idioms (Muhavre)
    {"id": 1, "lang": "hi", "target": "en", "category": "Hindi Idiom", "text": "दाल में कुछ काला है", "expected_concept": "fishy / suspicious"},
    {"id": 2, "lang": "hi", "target": "en", "category": "Hindi Idiom", "text": "आसमान से गिरा, खजूर में अटका", "expected_concept": "out of the frying pan into the fire"},
    {"id": 3, "lang": "hi", "target": "en", "category": "Hindi Idiom", "text": "नाच न जाने आँगन टेढ़ा", "expected_concept": "bad workman blames his tools"},
    {"id": 4, "lang": "hi", "target": "en", "category": "Hindi Idiom", "text": "अंगूठा दिखाना", "expected_concept": "refusal / mock"},
    {"id": 5, "lang": "hi", "target": "en", "category": "Hindi Idiom", "text": "कान भरना", "expected_concept": "poison ears / backbite / gossip"},
    {"id": 6, "lang": "hi", "target": "en", "category": "Hindi Idiom", "text": "पेट में चूहे कूद रहे हैं", "expected_concept": "starving / very hungry"},
    {"id": 7, "lang": "hi", "target": "en", "category": "Hindi Idiom", "text": "नौ दो ग्यारह होना", "expected_concept": "flee / run away"},

    # 2. Marathi Idioms & Expressions
    {"id": 8, "lang": "mr", "target": "en", "category": "Marathi Idiom", "text": "घरोघरी मातीच्या चुली", "expected_concept": "every house has same flaws / human nature"},
    {"id": 9, "lang": "mr", "target": "en", "category": "Marathi Idiom", "text": "काखेत कळसा गावाला वळसा", "expected_concept": "looking everywhere for what is right next to you"},
    {"id": 10, "lang": "mr", "target": "en", "category": "Marathi Colloquial", "text": "आज जेवणात काय बनवलं आहे?", "expected_concept": "what is made for meal / lunch / dinner today"},

    # 3. Tamil Expressions
    {"id": 11, "lang": "ta", "target": "en", "category": "Tamil Idiom", "text": "காக்கைக்கும் தன் குஞ்சு பொன் குஞ்சு", "expected_concept": "to a crow its own chick is gold / parent's love"},
    {"id": 12, "lang": "ta", "target": "en", "category": "Tamil Conversational", "text": "நீங்கள் எங்கே போகிறீர்கள்?", "expected_concept": "where are you going"},

    # 4. Telugu Expressions
    {"id": 13, "lang": "te", "target": "en", "category": "Telugu Idiom", "text": "కుక్క తోక పట్టుకుని గోదావరి ఈదినట్టు", "expected_concept": "foolish / futile attempt / crossing river holding dog tail"},
    {"id": 14, "lang": "te", "target": "en", "category": "Telugu Conversational", "text": "ఈ రోజు వాతావరణం చాలా బాగుంది", "expected_concept": "weather is very good today"},

    # 5. Code-Mixed Hinglish & Colloquial Slang
    {"id": 15, "lang": "hi", "target": "en", "category": "Hinglish / Colloquial", "text": "Bhai tu bohot bada topi baaz hai, sabko chuna laga raha hai", "expected_concept": "trickster / conning / bluffing everyone"},
    {"id": 16, "lang": "hi", "target": "en", "category": "Hinglish / Slang", "text": "Zyada hawa mein mat ud, zameen pe aa ja", "expected_concept": "don't act arrogant / be humble / get real"},

    # 6. Reverse English -> Indian Languages (Colloquial Subtitling)
    {"id": 17, "lang": "en", "target": "hi", "category": "English to Hindi", "text": "Don't judge a book by its cover.", "expected_concept": "शक्ल देखकर अक्ल मत आंक / ऊपरी दिखावे पर मत जाओ"},
    {"id": 18, "lang": "en", "target": "hi", "category": "English to Hindi", "text": "Hit the nail on the head.", "expected_concept": "सटीक बात कहना / सही निशाने पर लगना"},
    {"id": 19, "lang": "en", "target": "mr", "category": "English to Marathi", "text": "Better late than never.", "expected_concept": "कधीही न होण्यापेक्षा उशिरा झालेले बरे"},
    {"id": 20, "lang": "en", "target": "ta", "category": "English to Tamil", "text": "Actions speak louder than words.", "expected_concept": "செயல்களே வார்த்தைகளை விட வலிமையானவை"}
]

async def benchmark_translation(translator: UnifiedTranslator) -> Dict[str, Any]:
    print("\n" + "="*70)
    print(">>> 1. BENCHMARKING TRANSLATION ENGINES (GROK vs SARVAM MAYURA)")
    print("="*70)

    results = []

    for item in MULTILINGUAL_TEST_CASES:
        t_id = item["id"]
        src = item["lang"]
        tgt = item["target"]
        text = item["text"]
        cat = item["category"]

        entry = {
            "id": t_id,
            "category": cat,
            "source_lang": src,
            "target_lang": tgt,
            "input_text": text,
            "expected_concept": item["expected_concept"],
        }

        # 1. Test Grok directly
        grok_start = time.perf_counter()
        try:
            grok_out = await translator._translate_with_grok(text, src, tgt)
            grok_latency = round((time.perf_counter() - grok_start) * 1000, 1)
        except Exception as e:
            grok_out = f"ERROR: {e}"
            grok_latency = -1

        # 2. Test Sarvam Mayura directly
        sarvam_start = time.perf_counter()
        try:
            sarvam_out = await translator._translate_with_sarvam(text, src, tgt)
            sarvam_latency = round((time.perf_counter() - sarvam_start) * 1000, 1)
        except Exception as e:
            sarvam_out = f"ERROR: {e}"
            sarvam_latency = -1

        # 3. Test Unified Pipeline (with failover)
        pipe_start = time.perf_counter()
        pipe_out = await translator.translate(text, src, tgt)
        pipe_latency = round((time.perf_counter() - pipe_start) * 1000, 1)

        entry["grok"] = {"output": grok_out, "latency_ms": grok_latency}
        entry["sarvam_mayura"] = {"output": sarvam_out, "latency_ms": sarvam_latency}
        entry["unified_output"] = {"output": pipe_out, "latency_ms": pipe_latency}

        print(f"\n[Case #{t_id:02d} | {cat}] ({src} -> {tgt})")
        print(f"  Input: {text}")
        print(f"  -> Grok ({grok_latency}ms): {grok_out}")
        print(f"  -> Sarvam ({sarvam_latency}ms): {sarvam_out}")

        results.append(entry)

    return {"cases": results}

def benchmark_window_sizes(whisper: WhisperEngine) -> Dict[str, Any]:
    print("\n" + "="*70)
    print(">>> 2. BENCHMARKING WINDOW BUFFER SIZES ON AUDIO")
    print("="*70)

    # Generate synthetic 16kHz sine / speech-like tone bursts
    sample_rate = 16000
    window_sizes_sec = [0.2, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0]
    bench_results = []

    for sec in window_sizes_sec:
        num_samples = int(sec * sample_rate)
        # Synthetic speech-range buffer (harmonic bursts)
        t = np.linspace(0, sec, num_samples, endpoint=False, dtype=np.float32)
        audio = 0.3 * np.sin(2 * np.pi * 220 * t) + 0.1 * np.sin(2 * np.pi * 440 * t)

        t0 = time.perf_counter()
        res = whisper.transcribe(audio, language="en", is_final=True)
        dur_ms = round((time.perf_counter() - t0) * 1000, 1)

        rtf = round((dur_ms / 1000.0) / sec, 3) # Real-Time Factor (< 1.0 is faster than real-time)
        status = "Optimal" if rtf < 0.5 else ("Acceptable" if rtf <= 1.0 else "Too Slow for Real-Time")

        bench_results.append({
            "window_sec": sec,
            "samples": num_samples,
            "latency_ms": dur_ms,
            "real_time_factor": rtf,
            "evaluation": status,
        })
        print(f"  Window {sec:4.1f}s ({num_samples:5d} samples) -> Latency: {dur_ms:6.1f}ms | RTF: {rtf:5.3f} | {status}")

    return {"window_benchmarks": bench_results}

def benchmark_whisper_engine(whisper: WhisperEngine) -> Dict[str, Any]:
    print("\n" + "="*70)
    print(">>> 3. BENCHMARKING WHISPER TRANSCRIBER & LANGUAGE DETECTION")
    print("="*70)

    results = {
        "is_ready": whisper.is_ready(),
        "device": whisper.device,
        "compute_type": whisper.compute_type,
        "model_size": whisper.model_size,
    }

    # Evaluate LID on sample buffer
    dummy_audio = np.zeros(16000 * 2, dtype=np.float32)
    t0 = time.perf_counter()
    lang, prob = whisper.detect_language(dummy_audio)
    lid_ms = round((time.perf_counter() - t0) * 1000, 1)

    results["lid_benchmark"] = {
        "detected_lang": lang,
        "confidence": prob,
        "latency_ms": lid_ms,
    }
    print(f"  Whisper Status: Device={whisper.device}, Model={whisper.model_size}")
    print(f"  LID Latency: {lid_ms}ms (Detected: {lang}, Prob: {prob})")

    return results

async def main():
    report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "platform": sys.platform,
        "python_version": sys.version,
    }

    # 1. Model Initialization
    print("Initializing Whisper Engine...")
    whisper = WhisperEngine(model_size="large-v3-turbo")

    print("Initializing Unified Translator (Grok + Sarvam)...")
    translator = UnifiedTranslator()

    # 2. Run Benchmarks
    report["whisper_details"] = benchmark_whisper_engine(whisper)
    report["window_benchmarks"] = benchmark_window_sizes(whisper)
    report["translation_benchmarks"] = await benchmark_translation(translator)

    # 3. Save to results folder
    out_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "results")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "pipeline_benchmark_report.json")

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print("\n" + "="*70)
    print(f"COMPLETE: Full benchmark report written to: {out_file}")
    print("="*70)

if __name__ == "__main__":
    asyncio.run(main())

import os
import shutil
import tempfile
import numpy as np
import soundfile as sf
import yt_dlp
import imageio_ffmpeg

class StreamResolver:
    """
    Downloads the lowest-bitrate YouTube audio stream directly via yt-dlp
    and converts it to a 16kHz mono float32 numpy array for rapid lookahead ASR.
    """

    def __init__(self, cache_dir: str = None):
        if cache_dir is None:
            self.cache_dir = os.path.join(tempfile.gettempdir(), "livesub_audio_cache")
        else:
            self.cache_dir = cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)
        self.ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

    def get_cached_audio_path(self, video_id: str) -> str:
        return os.path.join(self.cache_dir, f"{video_id}_16k.wav")

    def fetch_video_audio(self, video_id: str) -> str:
        """
        Downloads the audio stream for the given YouTube videoId and saves as a 16kHz WAV file.
        Returns the absolute filepath to the 16k WAV file.
        """
        target_wav = self.get_cached_audio_path(video_id)
        if os.path.exists(target_wav) and os.path.getsize(target_wav) > 1000:
            print(f"[StreamResolver] Found cached audio for {video_id}: {target_wav}")
            return target_wav

        print(f"[StreamResolver] Fetching audio stream for videoId: {video_id} ...")
        url = f"https://www.youtube.com/watch?v={video_id}"
        temp_tmpl = os.path.join(self.cache_dir, f"{video_id}_raw.%(ext)s")

        ydl_opts = {
            "format": "ba[ext=m4a]/ba/b",
            "outtmpl": temp_tmpl,
            "quiet": True,
            "no_warnings": True,
            "extractor_args": {
                "youtube": {
                    "player_client": ["android", "ios", "mweb"]
                }
            },
            "http_headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            "ffmpeg_location": self.ffmpeg_exe,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "wav",
                }
            ],
            "postprocessor_args": [
                "-ar", "16000",
                "-ac", "1",
            ],
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        # yt-dlp extracts to {video_id}_raw.wav
        raw_wav = os.path.join(self.cache_dir, f"{video_id}_raw.wav")
        if os.path.exists(raw_wav):
            if os.path.exists(target_wav):
                os.remove(target_wav)
            shutil.move(raw_wav, target_wav)
            print(f"[StreamResolver] Audio saved to {target_wav} ({os.path.getsize(target_wav)} bytes)")
            return target_wav

        raise RuntimeError(f"[StreamResolver] Failed to extract audio for {video_id}")

    def load_audio_segment(
        self,
        wav_path: str,
        start_sec: float = 0.0,
        duration_sec: float = 60.0,
    ) -> np.ndarray:
        """
        Reads a window of audio [start_sec, start_sec + duration_sec] from the 16kHz mono WAV file.
        Returns float32 numpy array in [-1.0, 1.0].
        """
        sample_rate = 16000
        start_frame = int(start_sec * sample_rate)
        frames_to_read = int(duration_sec * sample_rate)

        with sf.SoundFile(wav_path, "r") as f:
            if start_frame >= len(f):
                return np.zeros(0, dtype=np.float32)
            f.seek(start_frame)
            data = f.read(frames_to_read, dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            return data

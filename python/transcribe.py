#!/usr/bin/env python3
"""
Transcribe an audio file using faster-whisper (small.en, int8 on CPU).
Usage: transcribe.py <audio_path>
Prints the transcribed text to stdout. Warnings/status go to stderr.
"""
import sys
from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: transcribe.py <audio_path>", file=sys.stderr)
        return 2
    audio_path = sys.argv[1]
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        audio_path,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
    )
    parts = [s.text.strip() for s in segments if s.text and s.text.strip()]
    sys.stdout.write(" ".join(parts).strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())

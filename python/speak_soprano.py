#!/usr/bin/env python3
"""
Synthesize speech from text using Soprano-TTS (CPU, 32 kHz WAV).
Reads text from stdin. Writes WAV file to the given output path.
Usage: speak_soprano.py <out_wav_path>
"""
import sys
from soprano import SopranoTTS


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: speak_soprano.py <out_wav_path>", file=sys.stderr)
        return 2
    out_path = sys.argv[1]
    text = sys.stdin.read().strip()
    if not text:
        print("empty text on stdin", file=sys.stderr)
        return 3
    model = SopranoTTS(backend="auto", device="cpu")
    model.infer(text, out_path=out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())

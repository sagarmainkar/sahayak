#!/usr/bin/env python3
"""
Persistent whisper transcription daemon.
Loads the model once, then serves one transcription per line of stdin.

Request  (one per line): {"id": "<req-id>", "path": "<audio-path>"}
Response (one per line): {"id": "<req-id>", "text": "..."} OR {"id": "...", "error": "..."}

Stays alive until stdin closes. Flushes every response.
"""
import json
import sys
from faster_whisper import WhisperModel

# base.en is ~5x faster than small.en on CPU, still high enough quality
# for dictation. int8 compute type is further ~2x faster than float32.
MODEL = WhisperModel("base.en", device="cpu", compute_type="int8")


def respond(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


# Announce readiness so the Node caller can tell when it's safe to send.
respond({"ready": True})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req_id = None
    try:
        req = json.loads(line)
        req_id = req.get("id")
        path = req["path"]
        segments, _info = MODEL.transcribe(path, beam_size=1)
        parts = [s.text.strip() for s in segments if s.text and s.text.strip()]
        text = " ".join(parts).strip()
        respond({"id": req_id, "text": text})
    except Exception as e:  # noqa: BLE001
        respond({"id": req_id, "error": str(e)})

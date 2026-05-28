#!/bin/bash
set -e

API="http://localhost:3000"
UPLOAD_DIR="/srv/work/sahayak/.data/bQ1tflv29Xhv/9LoT0n_g061_/uploads"
OUTPUT_DIR="/srv/work/sahayak/.data/video_outputs"
mkdir -p "$OUTPUT_DIR"

# Image 1: mountain pass with blue sky
IMG1="$UPLOAD_DIR/7dea784a85910ed9.jpg"
# Image 2: pine trees with snow  
IMG2="$UPLOAD_DIR/87ab68ff739c230f.jpg"
# Image 3: mountain hut
IMG3="$UPLOAD_DIR/d9457500c2b41e70.jpg"

function upload_image() {
  local path="$1"
  curl -s -X POST "$API/gradio_api/upload" -F "files=@$path" | tr -d '[]" '
}

function run_i2v() {
  local file_path="$1"
  local prompt="$2"
  local name="$3"
  
  echo "[$name] Uploading..."
  local uploaded=$(upload_image "$file_path")
  echo "[$name] Uploaded: $uploaded"
  
  echo "[$name] Starting video generation..."
  local event_id=$(curl -s -X POST "$API/gradio_api/call/v2/run_i2v" \
    -H "Content-Type: application/json" \
    -d "{\"image_pil\": {\"path\": \"$uploaded\", \"meta\": {\"_type\": \"gradio.FileData\"}}, \"prompt\": \"$prompt\", \"negative\": \"blurry, jittery, distorted, low quality\", \"video_model\": \"LTX 2.3 22B Q4 (Best quality, text-guided, ~4 min)\", \"steps\": 20}" | awk -F'"' '{print $4}')
  
  echo "[$name] EVENT_ID: $event_id"
  echo "[$name] Waiting for result stream..."
  
  # Stream and capture output
  local result=$(curl -s -N "$API/gradio_api/call/run_i2v/$event_id" | tee "$OUTPUT_DIR/${name}_stream.log" | grep '^data: \[{' | tail -1)
  
  echo "[$name] Raw result: $result"
  
  # Extract path
  local outpath=$(echo "$result" | grep -oP '"path":\s*"\K[^"]+' | head -1)
  echo "[$name] Output path: $outpath"
  
  if [ -n "$outpath" ] && [ -f "$outpath" ]; then
    cp "$outpath" "$OUTPUT_DIR/${name}.mp4"
    echo "[$name] ✅ Saved to $OUTPUT_DIR/${name}.mp4"
  else
    echo "[$name] ⚠️ Could not extract/copy output"
  fi
}

run_i2v "$IMG1" "slow cinematic pan across snowy mountain valley, dramatic clouds drifting overhead, majestic Himalayan peaks, crisp winter light, ethereal atmosphere" "01_mountain_pass"
run_i2v "$IMG2" "gentle snowfall, camera slowly pushes forward through snow-covered pine trees, misty mountain atmosphere, soft winter glow, peaceful forest scene" "02_pine_forest"
run_i2v "$IMG3" "fog slowly rolls past remote mountain cabin, camera gently zooms out revealing snowy peaks in background, serene winter morning, atmospheric mist" "03_mountain_hut"

echo ""
echo "All done! Files in $OUTPUT_DIR:"
ls -la "$OUTPUT_DIR"/*.mp4 2>/dev/null || true

#!/usr/bin/env bash
# Start sahayak in production mode (next build + next start)
# Much lower RAM than dev mode (~2-3 GB vs ~6 GB)
set -e
cd "$(dirname "$0")/.."

# Kill dev server if running
pkill -f "next dev -p 9999" 2>/dev/null || true
sleep 1

# Kill existing production instance
pkill -f "next start -p 9999" 2>/dev/null || true
sleep 1

echo "Building sahayak (production)... (this takes 1-2 min)"
npm run build

echo "Starting sahayak (production mode)..."
nohup npm run start > /tmp/sahayak-prod.log 2>&1 < /dev/null &
disown

echo "sahayak-prod → pid $! · log: /tmp/sahayak-prod.log"
echo "  tail -f /tmp/sahayak-prod.log     # watch"
echo "  pkill -f 'next start -p 9999'     # stop"

#!/usr/bin/env bash
# Start `npm run dev` detached from this shell.
# Stays running after ssh close. Logs to /tmp/sahayak.log.
# Re-run to restart (kills old instance first).
set -e
cd "$(dirname "$0")/.."

pkill -f "next dev -p 9999" 2>/dev/null || true
sleep 1

nohup npm run dev > /tmp/sahayak.log 2>&1 < /dev/null &
disown
echo "sahayak → pid $! · log: /tmp/sahayak.log"
echo "  tail -f /tmp/sahayak.log    # watch"
echo "  pkill -f 'next dev -p 9999' # stop"

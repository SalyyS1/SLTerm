#!/usr/bin/env bash
# Benchmark: Terminal rendering throughput
# Measures how fast the terminal can render high-volume output
# Tests with seq, yes, and large file cat

set -euo pipefail

RESULTS_DIR="$(dirname "$0")/results"
mkdir -p "$RESULTS_DIR"

RESULT_FILE="$RESULTS_DIR/baseline-throughput.json"

echo "=== Throughput Benchmark ==="
echo "Results: $RESULT_FILE"
echo ""

echo "Manual benchmark instructions:"
echo ""
echo "  Run these commands INSIDE a SLTerm terminal tab and measure wall time:"
echo ""
echo "  Test 1 - Sequential numbers (100k lines):"
echo "    time seq 1 100000"
echo "    → Record real time"
echo ""
echo "  Test 2 - Sequential numbers (1M lines):"
echo "    time seq 1 1000000"
echo "    → Record real time"
echo ""
echo "  Test 3 - Continuous output (bounded):"
echo "    time yes | head -n 100000"
echo "    → Record real time"
echo ""
echo "  Test 4 - Large single write:"
echo "    dd if=/dev/urandom bs=1024 count=1024 | base64 | time cat"
echo "    → Record real time"
echo ""
echo "  FPS measurement (Chrome DevTools):"
echo "    1. Open DevTools > Performance tab"
echo "    2. Start recording"
echo "    3. Run: seq 1 100000"
echo "    4. Stop recording"
echo "    5. Note: total frames, dropped frames, avg FPS"
echo ""
echo "  Rows/sec calculation:"
echo "    rows_per_sec = line_count / wall_time_seconds"
echo ""

cat > "$RESULT_FILE" << 'ENDJSON'
{
  "benchmark": "throughput",
  "timestamp": "",
  "tests": {
    "seq_100k": {
      "lines": 100000,
      "wall_time_sec": null,
      "rows_per_sec": null
    },
    "seq_1m": {
      "lines": 1000000,
      "wall_time_sec": null,
      "rows_per_sec": null
    },
    "yes_100k": {
      "lines": 100000,
      "wall_time_sec": null,
      "rows_per_sec": null
    },
    "base64_1mb": {
      "bytes": 1048576,
      "wall_time_sec": null
    }
  },
  "devtools_profile": {
    "total_frames": null,
    "dropped_frames": null,
    "avg_fps": null,
    "longest_frame_ms": null
  }
}
ENDJSON

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
sed -i "s/\"timestamp\": \"\"/\"timestamp\": \"$TIMESTAMP\"/" "$RESULT_FILE"

echo "Results template created at: $RESULT_FILE"
echo "Fill in measurements after running manual tests."

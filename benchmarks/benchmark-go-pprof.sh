#!/usr/bin/env bash
# Benchmark: Go backend pprof capture
# Captures CPU and heap profiles from the running Go server
# Requires debug:pprofport to be set in SLTerm config

set -euo pipefail

PPROF_PORT="${1:-6060}"
DURATION="${2:-30}"
RESULTS_DIR="$(dirname "$0")/results"
mkdir -p "$RESULTS_DIR"

echo "=== Go pprof Capture ==="
echo "Port: $PPROF_PORT"
echo "CPU duration: ${DURATION}s"
echo ""

BASE_URL="http://localhost:$PPROF_PORT"

# Check if pprof server is running
if ! curl -s "$BASE_URL/debug/pprof/" > /dev/null 2>&1; then
    echo "ERROR: pprof server not reachable at $BASE_URL"
    echo ""
    echo "To enable pprof, add to your SLTerm config:"
    echo '  "debug:pprofport": 6060'
    echo ""
    echo "Then restart SLTerm."
    exit 1
fi

echo "pprof server is running at $BASE_URL"
echo ""

# Capture heap profile
echo "Capturing heap profile..."
curl -s "$BASE_URL/debug/pprof/heap" > "$RESULTS_DIR/baseline-heap.prof"
echo "  Saved: $RESULTS_DIR/baseline-heap.prof"

# Capture allocs profile
echo "Capturing allocs profile..."
curl -s "$BASE_URL/debug/pprof/allocs" > "$RESULTS_DIR/baseline-allocs.prof"
echo "  Saved: $RESULTS_DIR/baseline-allocs.prof"

# Capture goroutine profile
echo "Capturing goroutine profile..."
curl -s "$BASE_URL/debug/pprof/goroutine" > "$RESULTS_DIR/baseline-goroutine.prof"
echo "  Saved: $RESULTS_DIR/baseline-goroutine.prof"

# Capture goroutine count (text)
echo "Capturing goroutine count..."
curl -s "$BASE_URL/debug/pprof/goroutine?debug=1" > "$RESULTS_DIR/baseline-goroutine-debug.txt"
GOROUTINE_COUNT=$(head -1 "$RESULTS_DIR/baseline-goroutine-debug.txt" | grep -oP '\d+' | head -1 || echo "unknown")
echo "  Goroutine count: $GOROUTINE_COUNT"

# Capture CPU profile (blocking for $DURATION seconds)
echo "Capturing CPU profile (${DURATION}s)..."
curl -s "$BASE_URL/debug/pprof/profile?seconds=$DURATION" > "$RESULTS_DIR/baseline-cpu.prof"
echo "  Saved: $RESULTS_DIR/baseline-cpu.prof"

echo ""
echo "=== Capture Complete ==="
echo ""
echo "Analyze profiles with:"
echo "  go tool pprof -text $RESULTS_DIR/baseline-heap.prof"
echo "  go tool pprof -text $RESULTS_DIR/baseline-cpu.prof"
echo "  go tool pprof -http=:8080 $RESULTS_DIR/baseline-cpu.prof"
echo ""
echo "Compare after optimization:"
echo "  go tool pprof -base $RESULTS_DIR/baseline-cpu.prof optimized-cpu.prof"

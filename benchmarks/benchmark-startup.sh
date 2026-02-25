#!/usr/bin/env bash
# Benchmark: Startup time measurement
# Measures time from app launch to wavesrv ready signal
# Runs multiple iterations and reports median/average

set -euo pipefail

ITERATIONS="${1:-5}"
RESULTS_DIR="$(dirname "$0")/results"
mkdir -p "$RESULTS_DIR"

RESULT_FILE="$RESULTS_DIR/baseline-startup.json"

echo "=== Startup Benchmark ==="
echo "Iterations: $ITERATIONS"
echo "Results: $RESULT_FILE"
echo ""

declare -a COLD_TIMES
declare -a WARM_TIMES

# Get system info
OS=$(uname -s)
ARCH=$(uname -m)
NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
GO_VERSION=$(go version 2>/dev/null | awk '{print $3}' || echo "unknown")
ELECTRON_VERSION=$(npx electron --version 2>/dev/null || echo "unknown")

echo "System: $OS $ARCH"
echo "Node: $NODE_VERSION"
echo "Go: $GO_VERSION"
echo "Electron: $ELECTRON_VERSION"
echo ""

# Note: These benchmarks require manual observation since Electron apps
# don't have a simple CLI-measurable "ready" signal.
# The performance marks added to emain.ts will log timing to the console.
#
# Usage:
# 1. Start the app in dev mode: npm run dev
# 2. Watch console output for [perf] lines
# 3. Record the startup-total measure
#
# For automated measurement, use Electron's --inspect flag:
#   ELECTRON_ENABLE_LOGGING=1 npm run dev 2>&1 | grep '\[perf\]'

echo "Manual benchmark instructions:"
echo ""
echo "  Cold start (clear caches first):"
echo "    1. Kill all SLTerm processes"
echo "    2. Clear Electron cache (optional for true cold start)"
echo "    3. ELECTRON_ENABLE_LOGGING=1 npm run dev 2>&1 | grep '\\[perf\\]'"
echo "    4. Record 'startup-total' value"
echo ""
echo "  Warm start (caches warm):"
echo "    1. Close SLTerm normally"
echo "    2. Immediately relaunch"
echo "    3. Record 'startup-total' value"
echo ""
echo "  The following performance marks are logged:"
echo "    - startup-total: Full startup time"
echo "    - wavesrv-init: Go server startup"
echo "    - electron-ready: Electron app.whenReady()"
echo "    - windows-init: Window creation + rendering"
echo ""

# Generate empty results template
cat > "$RESULT_FILE" << 'ENDJSON'
{
  "benchmark": "startup",
  "timestamp": "",
  "system": {
    "os": "",
    "arch": "",
    "node": "",
    "go": "",
    "electron": ""
  },
  "iterations": 5,
  "cold_start_ms": [],
  "warm_start_ms": [],
  "breakdown": {
    "wavesrv_init_ms": [],
    "electron_ready_ms": [],
    "windows_init_ms": []
  },
  "summary": {
    "cold_median_ms": null,
    "warm_median_ms": null,
    "cold_avg_ms": null,
    "warm_avg_ms": null
  }
}
ENDJSON

# Update system info in results
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
sed -i "s/\"timestamp\": \"\"/\"timestamp\": \"$TIMESTAMP\"/" "$RESULT_FILE"
sed -i "s/\"os\": \"\"/\"os\": \"$OS\"/" "$RESULT_FILE"
sed -i "s/\"arch\": \"\"/\"arch\": \"$ARCH\"/" "$RESULT_FILE"
sed -i "s/\"node\": \"\"/\"node\": \"$NODE_VERSION\"/" "$RESULT_FILE"
sed -i "s/\"go\": \"\"/\"go\": \"$GO_VERSION\"/" "$RESULT_FILE"
sed -i "s/\"electron\": \"\"/\"electron\": \"$ELECTRON_VERSION\"/" "$RESULT_FILE"

echo "Results template created at: $RESULT_FILE"
echo "Fill in measurements after running manual tests."

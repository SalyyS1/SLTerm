#!/usr/bin/env bash
# Benchmark: Memory usage measurement
# Measures process memory (RSS) with varying terminal tab counts
# Captures both Electron renderer and Go backend memory

set -euo pipefail

TAB_COUNTS="${1:-1 5 10 20}"
RESULTS_DIR="$(dirname "$0")/results"
mkdir -p "$RESULTS_DIR"

RESULT_FILE="$RESULTS_DIR/baseline-memory.json"

echo "=== Memory Benchmark ==="
echo "Tab counts: $TAB_COUNTS"
echo "Results: $RESULT_FILE"
echo ""

# System info
OS=$(uname -s)
ARCH=$(uname -m)
TOTAL_MEM=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024/1024)}' || echo "unknown")

echo "System: $OS $ARCH"
echo "Total RAM: ${TOTAL_MEM}MB"
echo ""

echo "Manual benchmark instructions:"
echo ""
echo "  For each tab count (1, 5, 10, 20):"
echo ""
echo "  1. Start SLTerm fresh"
echo "  2. Open N terminal tabs"
echo "  3. Wait 10s for stabilization"
echo "  4. Measure Electron process memory:"
echo "     ps aux | grep -i 'slterm\\|electron' | grep -v grep | awk '{sum+=\$6} END {print sum/1024 \"MB\"}'"
echo ""
echo "  5. Measure Go backend memory:"
echo "     ps aux | grep wavesrv | grep -v grep | awk '{print \$6/1024 \"MB\"}'"
echo ""
echo "  6. If pprof enabled (debug:pprofport in config):"
echo "     curl -s http://localhost:<port>/debug/pprof/heap > heap-N-tabs.prof"
echo "     go tool pprof -text heap-N-tabs.prof"
echo ""
echo "  7. Chrome DevTools memory snapshot:"
echo "     Open DevTools > Memory > Take heap snapshot"
echo ""
echo "  8. Renderer process.memoryUsage() (from DevTools console):"
echo "     JSON.stringify(process.memoryUsage())"
echo ""

# Generate results template
cat > "$RESULT_FILE" << 'ENDJSON'
{
  "benchmark": "memory",
  "timestamp": "",
  "system": {
    "os": "",
    "arch": "",
    "total_ram_mb": 0
  },
  "scenarios": {
    "1_tab": {
      "electron_rss_mb": null,
      "go_backend_rss_mb": null,
      "total_rss_mb": null,
      "renderer_heap_mb": null
    },
    "5_tabs": {
      "electron_rss_mb": null,
      "go_backend_rss_mb": null,
      "total_rss_mb": null,
      "renderer_heap_mb": null
    },
    "10_tabs": {
      "electron_rss_mb": null,
      "go_backend_rss_mb": null,
      "total_rss_mb": null,
      "renderer_heap_mb": null
    },
    "20_tabs": {
      "electron_rss_mb": null,
      "go_backend_rss_mb": null,
      "total_rss_mb": null,
      "renderer_heap_mb": null
    }
  },
  "go_pprof": {
    "heap_inuse_mb": null,
    "heap_alloc_mb": null,
    "goroutine_count": null
  }
}
ENDJSON

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
sed -i "s/\"timestamp\": \"\"/\"timestamp\": \"$TIMESTAMP\"/" "$RESULT_FILE"
sed -i "s/\"os\": \"\"/\"os\": \"$OS\"/" "$RESULT_FILE"
sed -i "s/\"arch\": \"\"/\"arch\": \"$ARCH\"/" "$RESULT_FILE"
sed -i "s/\"total_ram_mb\": 0/\"total_ram_mb\": $TOTAL_MEM/" "$RESULT_FILE"

echo "Results template created at: $RESULT_FILE"
echo "Fill in measurements after running manual tests."

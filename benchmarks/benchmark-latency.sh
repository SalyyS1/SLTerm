#!/usr/bin/env bash
# Benchmark: Input latency measurement
# Measures keypress-to-display round-trip time
# Uses terminal echo mode for measurement

set -euo pipefail

RESULTS_DIR="$(dirname "$0")/results"
mkdir -p "$RESULTS_DIR"

RESULT_FILE="$RESULTS_DIR/baseline-latency.json"

echo "=== Input Latency Benchmark ==="
echo "Results: $RESULT_FILE"
echo ""

echo "Manual benchmark instructions:"
echo ""
echo "  Method 1 - Chrome DevTools Performance recording:"
echo "    1. Open DevTools > Performance tab"
echo "    2. Enable 'Input' category in timeline"
echo "    3. Start recording"
echo "    4. Type ~20 characters at normal speed in terminal"
echo "    5. Stop recording"
echo "    6. Measure time between KeyDown event and next Paint event"
echo "    7. Record average across all keypresses"
echo ""
echo "  Method 2 - Slow-motion screen recording:"
echo "    1. Use OBS or similar at 120fps"
echo "    2. Record screen while typing"
echo "    3. Count frames between key visual press and character display"
echo "    4. latency_ms = frame_count * (1000 / fps)"
echo ""
echo "  Method 3 - Programmatic measurement (DevTools console):"
echo "    // Paste in DevTools console while terminal focused:"
echo "    let times = [];"
echo "    document.addEventListener('keydown', (e) => {"
echo "      e._perfStart = performance.now();"
echo "    });"
echo "    new MutationObserver(() => {"
echo "      const now = performance.now();"
echo "      // Approximate: last keydown to DOM mutation"
echo "      times.push(now);"
echo "      if (times.length >= 20) {"
echo "        console.log('Avg latency samples:', times.length);"
echo "      }"
echo "    }).observe(document.querySelector('.xterm-screen'), {"
echo "      childList: true, subtree: true, characterData: true"
echo "    });"
echo ""
echo "  Tab switch latency:"
echo "    1. Open 10+ tabs"
echo "    2. DevTools Performance recording"
echo "    3. Click different tabs rapidly"
echo "    4. Measure time from click to tab content render"
echo ""

cat > "$RESULT_FILE" << 'ENDJSON'
{
  "benchmark": "latency",
  "timestamp": "",
  "input_latency": {
    "method": "",
    "samples": 20,
    "min_ms": null,
    "max_ms": null,
    "avg_ms": null,
    "p50_ms": null,
    "p95_ms": null
  },
  "tab_switch_latency": {
    "samples": 10,
    "min_ms": null,
    "max_ms": null,
    "avg_ms": null,
    "p50_ms": null,
    "p95_ms": null
  },
  "cpu_idle": {
    "1_tab_percent": null,
    "5_tabs_percent": null,
    "10_tabs_percent": null,
    "20_tabs_percent": null
  }
}
ENDJSON

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
sed -i "s/\"timestamp\": \"\"/\"timestamp\": \"$TIMESTAMP\"/" "$RESULT_FILE"

echo "Results template created at: $RESULT_FILE"
echo "Fill in measurements after running manual tests."

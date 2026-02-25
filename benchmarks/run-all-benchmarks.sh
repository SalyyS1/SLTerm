#!/usr/bin/env bash
# Benchmark: Run all benchmarks and generate baseline report
# Orchestrates startup, memory, throughput, and latency benchmarks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

echo "========================================="
echo "  SLTerm Performance Baseline Suite"
echo "========================================="
echo ""
echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Directory: $SCRIPT_DIR"
echo ""

# Run each benchmark setup
echo "--- Setting up Startup Benchmark ---"
bash "$SCRIPT_DIR/benchmark-startup.sh"
echo ""

echo "--- Setting up Memory Benchmark ---"
bash "$SCRIPT_DIR/benchmark-memory.sh"
echo ""

echo "--- Setting up Throughput Benchmark ---"
bash "$SCRIPT_DIR/benchmark-throughput.sh"
echo ""

echo "--- Setting up Latency Benchmark ---"
bash "$SCRIPT_DIR/benchmark-latency.sh"
echo ""

echo "========================================="
echo "  All result templates created in:"
echo "  $RESULTS_DIR/"
echo ""
echo "  Files:"
ls -la "$RESULTS_DIR/"*.json 2>/dev/null || echo "  (no results yet)"
echo ""
echo "  Next steps:"
echo "  1. Start SLTerm in dev mode: npm run dev"
echo "  2. Follow instructions in each benchmark output"
echo "  3. Fill in the JSON result files"
echo "  4. Run this script again after optimizations"
echo "     to compare against baseline"
echo "========================================="

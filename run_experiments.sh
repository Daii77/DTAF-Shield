#!/bin/bash
# run_experiments.sh
# Automates the NS2 DTAF simulation and Python analysis

echo "================================================="
echo "   Running NS2 Simulation: Without Defense"
echo "================================================="
ns tcl/dtaf_ns2.tcl none
echo "Done. Trace saved to out_none.tr"
echo ""

echo "================================================="
echo "   Running NS2 Simulation: With DTAF"
echo "================================================="
ns tcl/dtaf_ns2.tcl dtaf
echo "Done. Trace saved to out_dtaf.tr"
echo ""

echo "================================================="
echo "   Analyzing Traces and Generating Plots..."
echo "================================================="
# Ensure pandas and matplotlib are installed
python3 analysis/analyze_ns2_trace.py

echo "================================================="
echo "   All tasks completed successfully!"
echo "   Check the analysis/ directory for the graphs."
echo "================================================="

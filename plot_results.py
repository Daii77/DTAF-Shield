#!/usr/bin/env python3
import csv, sys
import matplotlib.pyplot as plt

def load(csv_file):
    with open(csv_file, newline="") as f:
        return list(csv.DictReader(f))

def get(rows, scenario, defense, key):
    for r in rows:
        if r["scenario"] == scenario and r["defense"] == defense:
            return float(r[key])
    return 0.0

def line_plot(rows, key, ylabel, outpng):
    scenarios = ["baseline","low","med","high"]
    defenses = ["none","static","dtaf"]

    x = list(range(len(scenarios)))
    plt.figure()
    for d in defenses:
        y = [get(rows, s, d, key) for s in scenarios]
        plt.plot(x, y, marker="o", label=d)
    plt.xticks(x, scenarios)
    plt.xlabel("Attack level")
    plt.ylabel(ylabel)
    plt.grid(True)
    plt.legend()
    plt.tight_layout()
    plt.savefig(outpng, dpi=200)
    plt.close()

def main():
    if len(sys.argv) < 2:
        print("Usage: plot_results.py summary.csv")
        sys.exit(1)
    csv_file = sys.argv[1]
    rows = load(csv_file)

    line_plot(rows, "throughput_kbps", "Throughput (Kbps)", "dtaf_project/results/throughput.png")
    line_plot(rows, "avg_delay_ms", "Average Delay (ms)", "dtaf_project/results/delay.png")
    line_plot(rows, "loss_rate_pct", "Packet Loss (%)", "dtaf_project/results/loss.png")
    line_plot(rows, "fp_rate_pct", "False Positive Rate (%)", "dtaf_project/results/fp.png")
    print("PNG graphs saved to dtaf_project/results/")
if __name__ == "__main__":
    main()

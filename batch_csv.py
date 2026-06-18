#!/usr/bin/env python3
import os, csv, sys, glob, re

SIM_TIME = 60.0
FID_LEG = 1

def parse_trace(path):
    sent_time = {}
    recv_delays = []
    sent = recv = drop = 0
    recv_bytes = 0

    with open(path, "r", errors="ignore") as f:
        for line in f:
            if not line or line[0] not in "+-rds":
                continue
            parts = line.split()
            if len(parts) < 12:
                continue
            ev = parts[0]
            try:
                t = float(parts[1])
            except:
                continue
            try:
                size = int(parts[5])
            except:
                size = 0
            try:
                fid = int(parts[7])
                uid = int(parts[11])
            except:
                continue
            if fid != FID_LEG:
                continue

            if ev == "+":
                sent += 1
                sent_time[uid] = t
            elif ev == "r":
                recv += 1
                recv_bytes += size
                if uid in sent_time:
                    recv_delays.append((t - sent_time[uid]) * 1000.0)
            elif ev == "d":
                drop += 1

    avg_delay = sum(recv_delays) / len(recv_delays) if recv_delays else 0.0
    loss_rate = ((sent - recv) / sent * 100.0) if sent > 0 else 0.0
    throughput_kbps = (recv_bytes * 8.0 / SIM_TIME) / 1000.0
    return throughput_kbps, avg_delay, loss_rate, sent, recv, drop

def parse_dtaf_log(path):
    fp = 0
    total_leg = 0
    with open(path, "r", errors="ignore") as f:
        for line in f:
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 6:
                continue
            fid = int(parts[2])
            action = parts[5]
            if fid == FID_LEG:
                total_leg += 1
                if action == "DROP":
                    fp += 1
    fp_rate = (fp / total_leg * 100.0) if total_leg > 0 else 0.0
    return fp_rate

def main():
    results_dir = sys.argv[1] if len(sys.argv) > 1 else "dtaf_project/results"
    out_csv = sys.argv[2] if len(sys.argv) > 2 else os.path.join(results_dir, "summary.csv")

    # expected naming: baseline_dtaf.tr, low_static.tr, med_none.tr, high_dtaf.tr ...
    files = sorted(glob.glob(os.path.join(results_dir, "*.tr")))

    rows = []
    for tr in files:
        base = os.path.splitext(os.path.basename(tr))[0]
        log = os.path.join(results_dir, base + ".dtaf.log")
        if not os.path.exists(log):
            # some runs might miss log; skip
            continue

        # infer scenario from filename prefix
        # baseline/low/med/high + defense none/static/dtaf
        m = re.match(r"^(baseline|low|med|high)_(dtaf|static|none)$", base)
        if not m:
            continue
        attack_level = m.group(1)
        defense = m.group(2)

        thr, delay, loss, sent, recv, drop = parse_trace(tr)
        fp = parse_dtaf_log(log)

        rows.append({
            "scenario": attack_level,
            "defense": defense,
            "throughput_kbps": f"{thr:.2f}",
            "avg_delay_ms": f"{delay:.2f}",
            "loss_rate_pct": f"{loss:.2f}",
            "fp_rate_pct": f"{fp:.2f}",
            "sent": sent,
            "recv": recv,
            "drop": drop
        })

    # sort nicely
    scen_order = {"baseline":0, "low":1, "med":2, "high":3}
    def_order = {"none":0, "static":1, "dtaf":2}
    rows.sort(key=lambda r: (scen_order.get(r["scenario"],99), def_order.get(r["defense"],99)))

    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else
                           ["scenario","defense","throughput_kbps","avg_delay_ms","loss_rate_pct","fp_rate_pct","sent","recv","drop"])
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print("Wrote:", out_csv)
    print("Rows:", len(rows))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import sys
from collections import defaultdict

# Minimal NS2 trace parser (works with common "new trace" formats)
# We focus on legitimate flow fid=1 as per run_dtaf.tcl

FID_LEG = 1

def parse_trace(path):
    sent_time = {}
    recv_delays = []
    sent = 0
    recv = 0
    drop = 0
    recv_bytes = 0

    with open(path, "r", errors="ignore") as f:
        for line in f:
            if not line or line[0] not in "+-rds":
                continue
            parts = line.split()
            ev = parts[0]
            try:
                t = float(parts[1])
            except:
                continue

            # Heuristics for fields:
            # Many ns2 traces include: ... fid ... uid ... size ...
            # We'll search for "fid" and "uid" by best-effort:
            fid = None
            uid = None
            size = None

            # common: parts[7]=fid, parts[11]=uid, parts[5]=pktType, parts[8]=src, parts[9]=dst, parts[5]=...
            # We'll just scan tokens for known patterns isn't consistent, so fallback to indices if exist.
            # Try typical newtrace indices:
            if len(parts) > 11:
                # these often work in many ns2 builds
                try:
                    size = int(parts[5])
                except:
                    size = None
                try:
                    fid = int(parts[7])
                except:
                    fid = None
                try:
                    uid = int(parts[11])
                except:
                    uid = None

            # If not found, skip
            if fid != FID_LEG or uid is None:
                continue

            if ev == "+":
                sent += 1
                sent_time[uid] = t
            elif ev == "r":
                recv += 1
                if size:
                    recv_bytes += size
                if uid in sent_time:
                    recv_delays.append((t - sent_time[uid]) * 1000.0)  # ms
            elif ev == "d":
                drop += 1

    avg_delay = sum(recv_delays) / len(recv_delays) if recv_delays else 0.0
    loss_rate = (max(sent - recv, 0) / sent * 100.0) if sent > 0 else 0.0

    # throughput kbps over simulation time (approx from last recv time)
    sim_time = 60.0
    throughput_kbps = (recv_bytes * 8.0 / sim_time) / 1000.0

    return {
        "sent": sent,
        "recv": recv,
        "drop": drop,
        "throughput_kbps": throughput_kbps,
        "avg_delay_ms": avg_delay,
        "loss_rate_pct": loss_rate,
    }

def parse_dtaf_log(path):
    # time uid fid rate threshold action
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
    return {"fp": fp, "total_leg_at_filter": total_leg, "fp_rate_pct": fp_rate}

def main():
    if len(sys.argv) < 3:
        print("Usage: analyze.py trace.tr dtaf.log")
        sys.exit(1)

    tr = parse_trace(sys.argv[1])
    lg = parse_dtaf_log(sys.argv[2])

    print("=== Results ===")
    print(f"Throughput (Kbps): {tr['throughput_kbps']:.2f}")
    print(f"Avg Delay (ms):    {tr['avg_delay_ms']:.2f}")
    print(f"Packet Loss (%):   {tr['loss_rate_pct']:.2f}")
    print(f"FP Rate (%):       {lg['fp_rate_pct']:.2f}")
    print(f"Sent/Recv/Drop:    {tr['sent']}/{tr['recv']}/{tr['drop']}  (leg fid=1)")

if __name__ == "__main__":
    main()

import pandas as pd
import matplotlib.pyplot as plt
import os

def parse_trace(trace_file):
    """
    Parses NS2 .tr file and extracts simulation data.
    Format of standard NS2 trace:
    Event Time FromNode ToNode PktType PktSize Flags FlowID SrcAddr DstAddr SeqNum PktID
    """
    data = []
    
    with open(trace_file, 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 11:
                event = parts[0]     # r, +, -, d
                time = float(parts[1])
                from_node = parts[2]
                to_node = parts[3]
                pkt_type = parts[4]
                pkt_size = int(parts[5])
                flow_id = parts[7]
                
                data.append({
                    'event': event,
                    'time': time,
                    'from': from_node,
                    'to': to_node,
                    'type': pkt_type,
                    'size': pkt_size,
                    'fid': flow_id
                })
                
    return pd.DataFrame(data)

def analyze_and_plot(trace_none, trace_dtaf, output_prefix):
    print("Parsing No-Defense trace...")
    df_none = parse_trace(trace_none)
    
    print("Parsing DTAF trace...")
    df_dtaf = parse_trace(trace_dtaf)

    def calculate_metrics(df):
        # Calculate Throughput over time (interval = 1 second)
        # Throughput = bytes received at Server (node 3) for Legit Traffic (fid == '1')
        received = df[(df['event'] == 'r') & (df['to'] == '3') & (df['fid'] == '1')].copy()
        received['time_sec'] = received['time'].astype(int)
        throughput = received.groupby('time_sec')['size'].sum() * 8 / 1000  # Kbps
        
        # Calculate Packet Loss over time
        # Loss = packets dropped ('d') for Legit Traffic
        dropped = df[(df['event'] == 'd') & (df['fid'] == '1')].copy()
        dropped['time_sec'] = dropped['time'].astype(int)
        loss = dropped.groupby('time_sec').size()
        
        # Calculate Attack Throughput received at Server (fid == '2')
        attack_received = df[(df['event'] == 'r') & (df['to'] == '3') & (df['fid'] == '2')].copy()
        attack_received['time_sec'] = attack_received['time'].astype(int)
        attack_throughput = attack_received.groupby('time_sec')['size'].sum() * 8 / 1000
        
        return throughput, loss, attack_throughput

    print("Calculating metrics...")
    tp_none, loss_none, att_tp_none = calculate_metrics(df_none)
    tp_dtaf, loss_dtaf, att_tp_dtaf = calculate_metrics(df_dtaf)

    # Plot 1: Legitimate Throughput
    plt.figure(figsize=(10, 5))
    plt.plot(tp_none.index, tp_none.values, label='Without Defense (None)', color='red', linestyle='--')
    plt.plot(tp_dtaf.index, tp_dtaf.values, label='With DTAF', color='blue')
    plt.title('Legitimate Traffic Throughput')
    plt.xlabel('Time (Seconds)')
    plt.ylabel('Throughput (Kbps)')
    plt.axvspan(10, 40, color='gray', alpha=0.2, label='DoS Attack Active')
    plt.legend()
    plt.grid(True)
    plt.savefig(f'{output_prefix}_throughput.png')
    plt.close()

    # Plot 2: Legitimate Packet Loss
    plt.figure(figsize=(10, 5))
    plt.plot(loss_none.index, loss_none.values, label='Without Defense (None)', color='red', linestyle='--')
    plt.plot(loss_dtaf.index, loss_dtaf.values, label='With DTAF', color='blue')
    plt.title('Legitimate Packet Loss (Drops/sec)')
    plt.xlabel('Time (Seconds)')
    plt.ylabel('Number of Dropped Packets')
    plt.axvspan(10, 40, color='gray', alpha=0.2, label='DoS Attack Active')
    plt.legend()
    plt.grid(True)
    plt.savefig(f'{output_prefix}_packet_loss.png')
    plt.close()

    # Plot 3: Attack Traffic Reaching Server
    plt.figure(figsize=(10, 5))
    plt.plot(att_tp_none.index, att_tp_none.values, label='Without Defense', color='red', linestyle='--')
    plt.plot(att_tp_dtaf.index, att_tp_dtaf.values, label='With DTAF Filtering', color='green')
    plt.title('Attack Traffic Reaching the Server')
    plt.xlabel('Time (Seconds)')
    plt.ylabel('Throughput (Kbps)')
    plt.axvspan(10, 40, color='gray', alpha=0.2, label='DoS Attack Active')
    plt.legend()
    plt.grid(True)
    plt.savefig(f'{output_prefix}_attack_throughput.png')
    plt.close()

    print(f"Analysis complete. Graphs saved with prefix: {output_prefix}")

if __name__ == "__main__":
    if not os.path.exists("out_none.tr") or not os.path.exists("out_dtaf.tr"):
        print("Error: Trace files 'out_none.tr' or 'out_dtaf.tr' not found. Run the NS2 simulation first.")
    else:
        analyze_and_plot("out_none.tr", "out_dtaf.tr", "analysis/dtaf_results")

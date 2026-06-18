"""
DTAF Shield - Advanced NS2 Network Simulator Engine
Simulates: DoS/DDoS attacks, device behavior, adaptive filtering, real-time metrics
"""
import math
import random
import time
from typing import Optional

# ──────────────────────────────────────────────────────────────────────────────
# DEVICE PROFILES  (bandwidth Mbps, base_delay ms, queue_size pkts)
# ──────────────────────────────────────────────────────────────────────────────
DEVICE_PROFILES = {
    "router":    {"bw": 1000, "base_delay": 0.5,  "queue": 512, "proc_delay": 0.1},
    "switch":    {"bw": 100,  "base_delay": 0.2,  "queue": 256, "proc_delay": 0.05},
    "server":    {"bw": 1000, "base_delay": 1.0,  "queue": 1024,"proc_delay": 0.5},
    "firewall":  {"bw": 500,  "base_delay": 2.0,  "queue": 256, "proc_delay": 1.0},
    "attacker":  {"bw": 100,  "base_delay": 10.0, "queue": 64,  "proc_delay": 0.0},
    "client":    {"bw": 10,   "base_delay": 5.0,  "queue": 64,  "proc_delay": 0.2},
    "ids":       {"bw": 1000, "base_delay": 1.5,  "queue": 512, "proc_delay": 1.5},
    "load_balancer": {"bw": 10000, "base_delay": 0.3, "queue": 2048, "proc_delay": 0.2},
}

ATTACK_PROFILES = {
    "syn_flood":   {"pkt_size": 60,   "burst_factor": 1.8, "name": "SYN Flood"},
    "udp_flood":   {"pkt_size": 1024, "burst_factor": 1.5, "name": "UDP Flood"},
    "icmp_flood":  {"pkt_size": 64,   "burst_factor": 2.0, "name": "ICMP Flood"},
    "http_flood":  {"pkt_size": 512,  "burst_factor": 1.2, "name": "HTTP Flood"},
    "slowloris":   {"pkt_size": 256,  "burst_factor": 0.3, "name": "Slowloris"},
    "amplification":{"pkt_size":1500, "burst_factor":3.0,  "name": "Amplification"},
}


# ──────────────────────────────────────────────────────────────────────────────
# DTAF ADAPTIVE THRESHOLD ENGINE
# ──────────────────────────────────────────────────────────────────────────────
class DTAFEngine:
    """Dynamic Traffic-Aware Filtering core algorithm"""
    def __init__(self, learning_window=10, alpha=0.15, beta=2.5):
        self.baseline     = None
        self.ewma         = None
        self.alpha        = alpha          # EWMA smoothing factor
        self.beta         = beta           # threshold multiplier
        self.learning_window = learning_window
        self.window_data  = []
        self.threshold    = None
        self.state        = "learning"     # learning | active | alert
        self.fp_history   = []
        self.tp_history   = []

    def update(self, t, legit_pps, total_pps, step=1):
        """Feed current traffic; returns (threshold, action, stats)"""
        self.window_data.append(total_pps)
        if len(self.window_data) > 30:
            self.window_data.pop(0)

        # EWMA update
        if self.ewma is None:
            self.ewma = total_pps
        else:
            self.ewma = self.alpha * total_pps + (1 - self.alpha) * self.ewma

        # Establish baseline from calm period
        if t < self.learning_window:
            self.state = "learning"
            self.baseline = self.ewma
            self.threshold = self.baseline * self.beta
            return self.threshold, "PASS", 0.0

        # Compute adaptive threshold
        std = _std(self.window_data)
        self.threshold = self.baseline * self.beta + std * 1.5
        self.state = "active"

        attack_pps = max(0, total_pps - legit_pps)
        if total_pps > self.threshold:
            self.state = "alert"
            # drop_ratio: sigmoid-based to avoid hard cutoffs
            excess = (total_pps - self.threshold) / max(self.threshold, 1)
            drop_ratio = _sigmoid(excess * 3)
            # Accurately target attack packets
            attack_blocked = int(attack_pps * drop_ratio * 0.98)   # 98% detection
            legit_dropped  = int(legit_pps  * drop_ratio * 0.02)   # 2% false positive
            return self.threshold, "FILTER", drop_ratio
        return self.threshold, "PASS", 0.0


class StaticThresholdEngine:
    """Fixed-rate threshold filter (800 pps default)"""
    def __init__(self, threshold=800):
        self.threshold = threshold

    def update(self, t, legit_pps, total_pps, step=1):
        if total_pps > self.threshold:
            excess = max(0, total_pps - self.threshold)
            drop_ratio = min(0.95, excess / total_pps)
            return self.threshold, "FILTER", drop_ratio
        return self.threshold, "PASS", 0.0


# ──────────────────────────────────────────────────────────────────────────────
# TOPOLOGY ANALYSIS
# ──────────────────────────────────────────────────────────────────────────────
def _analyze_topology(topology):
    """Extract network characteristics from workspace topology"""
    default_topo = {
        "num_nodes": 4, 
        "has_firewall": False, 
        "has_ids": False,
        "has_lb": False,
        "bottleneck_bw": 1000, 
        "hop_count": 3, 
        "attacker_count": 1,
        "server_count": 1, 
        "switch_count": 0,
        "router_count": 0,
        "attack_type": "syn_flood",
        "legit_reachable": True,
        "attacker_reachable": True,
        "has_firewall_on_path": False,
        "has_ids_on_path": False,
        "has_lb_on_path": False,
        "acl_block_ratio": 0.0
    }
    if not topology or not isinstance(topology, dict):
        return default_topo

    nodes = topology.get("nodes", [])
    edges = topology.get("edges", [])

    if not nodes:
        return default_topo

    node_types = {n["id"]: n.get("type", "router") for n in nodes}
    type_counts = {}
    for t in node_types.values():
        type_counts[t] = type_counts.get(t, 0) + 1

    # Bottleneck = minimum bandwidth link in path
    min_bw = 1000
    for e in edges:
        src = e.get("source") or e.get("from")
        dst = e.get("target") or e.get("to")
        src_type = node_types.get(src, "router")
        dst_type = node_types.get(dst, "router")
        bw = min(DEVICE_PROFILES.get(src_type, {}).get("bw", 1000),
                 DEVICE_PROFILES.get(dst_type, {}).get("bw", 1000))
        min_bw = min(min_bw, bw)

    # Path analysis using active graph
    # Check interface status on links
    active_links = []
    node_states = {n["id"]: n for n in nodes} # node object with configuration

    for e in edges:
        src = e.get("source") or e.get("from")
        dst = e.get("target") or e.get("to")
        src_if = e.get("fromInterface")
        dst_if = e.get("toInterface")
        
        src_up = True
        if src in node_states and src_if:
            ifaces = node_states[src].get("interfaces", {})
            if isinstance(ifaces, dict):
                src_up = ifaces.get(src_if, {}).get("status", "up") == "up"
            elif isinstance(ifaces, list):
                iface = next((i for i in ifaces if i.get("name") == src_if), {})
                src_up = iface.get("status", "up") == "up"

        dst_up = True
        if dst in node_states and dst_if:
            ifaces = node_states[dst].get("interfaces", {})
            if isinstance(ifaces, dict):
                dst_up = ifaces.get(dst_if, {}).get("status", "up") == "up"
            elif isinstance(ifaces, list):
                iface = next((i for i in ifaces if i.get("name") == dst_if), {})
                dst_up = iface.get("status", "up") == "up"

        if src_up and dst_up:
            active_links.append((src, dst))

    # Build adjacency list
    adj = {}
    for u, v in active_links:
        if u not in adj: adj[u] = []
        if v not in adj: adj[v] = []
        adj[u].append(v)
        adj[v].append(u)

    def get_shortest_path(start_ids, end_ids):
        if not start_ids or not end_ids:
            return []
        visited = {sid: None for sid in start_ids}
        queue = list(start_ids)
        found_end = None
        while queue:
            curr = queue.pop(0)
            if curr in end_ids:
                found_end = curr
                break
            for nbr in adj.get(curr, []):
                if nbr not in visited:
                    visited[nbr] = curr
                    queue.append(nbr)
        if found_end is None:
            return []
        # Reconstruct path
        path = []
        curr = found_end
        while curr is not None:
            path.append(curr)
            curr = visited[curr]
        path.reverse()
        return path

    client_ids = [n["id"] for n in nodes if n.get("type") == "client"]
    attacker_ids = [n["id"] for n in nodes if n.get("type") == "attacker"]
    server_ids = [n["id"] for n in nodes if n.get("type") == "server"]

    legit_reachable = True
    legit_path = []
    if client_ids and server_ids:
        legit_path = get_shortest_path(client_ids, server_ids)
        legit_reachable = len(legit_path) > 0

    attacker_reachable = True
    atk_path = []
    if attacker_ids and server_ids:
        atk_path = get_shortest_path(attacker_ids, server_ids)
        attacker_reachable = len(atk_path) > 0

    # Check for security nodes on attacker path
    has_fw_path = any(node_types.get(nid) == "firewall" for nid in atk_path)
    has_ids_path = any(node_types.get(nid) == "ids" for nid in atk_path)
    has_lb_path = any(node_types.get(nid) == "load_balancer" for nid in atk_path)

    # Check if there is an access-list block rule on any node in attacker's path
    acl_block_ratio = 0.0
    for nid in atk_path:
        node_obj = node_states.get(nid, {})
        # Access list structure: list of {"action": "deny"|"permit", ...}
        acls = node_obj.get("accessLists") or node_obj.get("acls")
        if acls and isinstance(acls, list):
            for rule in acls:
                if rule.get("action") == "deny":
                    acl_block_ratio = 0.95  # 95% blocking efficiency for deny rule
                    break
            if acl_block_ratio > 0:
                break

    return {
        "num_nodes":      len(nodes),
        "has_firewall":   type_counts.get("firewall", 0) > 0,
        "has_ids":        type_counts.get("ids", 0) > 0,
        "has_lb":         type_counts.get("load_balancer", 0) > 0,
        "bottleneck_bw":  min_bw,
        "hop_count":      max(2, len(edges) // max(1, len(nodes) // 2)),
        "attacker_count": type_counts.get("attacker", 0) or 1,
        "server_count":   type_counts.get("server", 0) or 1,
        "switch_count":   type_counts.get("switch", 0) or 0,
        "router_count":   type_counts.get("router", 0) or 0,
        "attack_type":    topology.get("attack_type", "syn_flood"),
        "legit_reachable": legit_reachable,
        "attacker_reachable": attacker_reachable,
        "has_firewall_on_path": has_fw_path,
        "has_ids_on_path": has_ids_path,
        "has_lb_on_path": has_lb_path,
        "acl_block_ratio": acl_block_ratio
    }


# ──────────────────────────────────────────────────────────────────────────────
# MAIN SIMULATION RUNNER
# ──────────────────────────────────────────────────────────────────────────────
def run_simulation(defense_mode: str, attack_pps: int, duration: int,
                   topology=None, time_step: int = 1) -> dict:
    """
    Full NS2-style simulation.
    Returns time-series data + summary statistics.
    """
    random.seed(42)
    topo = _analyze_topology(topology)
    atk_profile = ATTACK_PROFILES.get(topo.get("attack_type", "syn_flood"),
                                       ATTACK_PROFILES["syn_flood"])

    # Network parameters
    legit_base_pps  = 150 + topo["server_count"] * 30
    pkt_size_bytes  = 512
    atk_pkt_bytes   = atk_profile["pkt_size"]
    bottleneck_bw   = topo["bottleneck_bw"] * 1_000 / 8  # bytes/sec
    base_delay_ms   = sum(
        DEVICE_PROFILES.get(nt, DEVICE_PROFILES["router"])["base_delay"]
        for nt in ["router","switch","server"]
    ) * (1 + topo["hop_count"] * 0.1)

    # Build defense engine
    if defense_mode == "dtaf":
        engine = DTAFEngine(learning_window=10, alpha=0.15, beta=2.5)
    elif defense_mode == "static":
        engine = StaticThresholdEngine(threshold=800)
    else:
        engine = None  # No defense

    # Extra defense layers from topology, checking if inline on active path
    firewall_block_ratio = 0.30 if topo.get("has_firewall_on_path", topo["has_firewall"]) else 0.0
    ids_block_ratio      = 0.20 if topo.get("has_ids_on_path", topo["has_ids"]) else 0.0
    lb_benefit           = 0.40 if topo.get("has_lb_on_path", topo["has_lb"]) else 0.0
    
    # Custom Access List rule block ratio from path configuration
    acl_block_ratio = topo.get("acl_block_ratio", 0.0)
    if acl_block_ratio > 0.0:
        firewall_block_ratio = max(firewall_block_ratio, acl_block_ratio)

    # Time-series containers
    labels        = []
    attack_traffic    = []
    legit_traffic_ts  = []
    total_traffic_ts  = []
    attack_dropped_ts = []
    legit_dropped_ts  = []
    legit_passed_ts   = []
    throughput_ts     = []
    delay_ts          = []
    packet_loss_ts    = []
    threshold_ts      = []
    queue_util_ts     = []
    defense_state_ts  = []

    # Cumulative stats
    cum_attack_blocked = 0
    cum_legit_sent     = 0
    cum_legit_recv     = 0

    for t in range(0, duration, time_step):
        labels.append(t)

        # ── Traffic generation ──
        legit_noise = random.gauss(0, legit_base_pps * 0.08)
        legit_pps   = max(10, legit_base_pps + legit_noise)
        
        # If client-to-server path is broken, no legit traffic can reach the server
        if not topo.get("legit_reachable", True):
            legit_pps = 0

        # Attack ramp: 0 before t=10, ramp up 10-20, full 20+
        if t < 10:
            eff_attack = 0
        elif t < 20:
            eff_attack = attack_pps * ((t - 10) / 10)
        else:
            # Burst pattern
            burst = atk_profile["burst_factor"]
            phase = math.sin(t * 0.3)
            eff_attack = attack_pps * (1.0 + 0.2 * phase * burst)

        # Multi-attacker amplification
        eff_attack *= topo["attacker_count"]
        atk_noise   = random.gauss(0, eff_attack * 0.05) if eff_attack > 0 else 0
        eff_attack  = max(0, eff_attack + atk_noise)
        
        # If attacker-to-server path is broken, no attack traffic can reach the server
        if not topo.get("attacker_reachable", True):
            eff_attack = 0

        # Pre-filter: firewall + IDS
        pre_blocked = eff_attack * (firewall_block_ratio + ids_block_ratio)
        eff_attack_post = eff_attack - pre_blocked

        total_pps = legit_pps + eff_attack_post

        # ── Defense engine ──
        atk_dropped_this = 0
        leg_dropped_this = 0
        drop_ratio       = 0.0
        thr_val          = None
        state_label      = "idle"

        if engine:
            thr_val, action, drop_ratio = engine.update(t, legit_pps, total_pps)
            if action == "FILTER":
                atk_dropped_this = int(eff_attack_post * drop_ratio * 0.98)
                leg_dropped_this = int(legit_pps * drop_ratio * 0.02)
                state_label = "alert"
            elif action == "PASS":
                state_label = "learning" if t < 10 else "active"
        
        # Load balancer benefit: reduces collateral
        if topo["has_lb"]:
            leg_dropped_this = max(0, int(leg_dropped_this * (1 - lb_benefit)))

        leg_passed_this = max(0, int(legit_pps) - leg_dropped_this)

        # ── Queue & bandwidth modeling ──
        actual_load = (leg_passed_this + max(0, int(eff_attack_post) - atk_dropped_this)) * pkt_size_bytes
        queue_util  = min(1.0, actual_load / bottleneck_bw)

        # ── Delay (queuing + propagation + processing) ──
        queue_delay  = queue_util ** 2 * 150 * (1 + topo["hop_count"] * 0.2)
        prop_delay   = base_delay_ms
        proc_delay   = 0.5 * (1 + drop_ratio * 2)
        total_delay  = prop_delay + queue_delay + proc_delay + random.gauss(0, 1)
        total_delay  = max(0.5, total_delay)

        # ── Throughput (Kbps) ──
        useful_bytes  = leg_passed_this * pkt_size_bytes
        throughput_kb = (useful_bytes * 8) / (1000 * time_step)
        # Cap at bottleneck
        throughput_kb = min(throughput_kb, bottleneck_bw * 8 / 1000)

        # ── Packet loss (%) for legitimate traffic ──
        loss_pct = (leg_dropped_this / max(1, int(legit_pps))) * 100
        loss_pct = min(100, loss_pct + queue_util * 5)

        # Cumulative
        cum_attack_blocked += atk_dropped_this + pre_blocked
        cum_legit_sent     += int(legit_pps)
        cum_legit_recv     += leg_passed_this

        # Append
        attack_traffic.append(round(eff_attack, 1))
        legit_traffic_ts.append(round(legit_pps, 1))
        total_traffic_ts.append(round(total_pps, 1))
        attack_dropped_ts.append(round(atk_dropped_this + pre_blocked, 1))
        legit_dropped_ts.append(round(leg_dropped_this, 1))
        legit_passed_ts.append(round(leg_passed_this, 1))
        throughput_ts.append(round(throughput_kb, 2))
        delay_ts.append(round(total_delay, 2))
        packet_loss_ts.append(round(loss_pct, 2))
        threshold_ts.append(round(thr_val, 1) if thr_val else None)
        queue_util_ts.append(round(queue_util * 100, 1))
        defense_state_ts.append(state_label)

    # ── Summary ──
    avg_thr  = round(sum(throughput_ts) / len(throughput_ts), 2)
    avg_dly  = round(sum(delay_ts) / len(delay_ts), 2)
    avg_loss = round(sum(packet_loss_ts) / len(packet_loss_ts), 2)
    deliv    = round((cum_legit_recv / max(1, cum_legit_sent)) * 100, 1)

    return {
        "defense_mode":    defense_mode,
        "attack_pps":      attack_pps,
        "duration":        duration,
        "labels":          labels,
        "attack_traffic":  attack_traffic,
        "legit_traffic":   legit_traffic_ts,
        "total_traffic":   total_traffic_ts,
        "attack_dropped":  attack_dropped_ts,
        "legit_dropped":   legit_dropped_ts,
        "legit_passed":    legit_passed_ts,
        "throughput":      throughput_ts,
        "delay":           delay_ts,
        "packet_loss":     packet_loss_ts,
        "threshold":       threshold_ts,
        "queue_utilization": queue_util_ts,
        "defense_states":  defense_state_ts,
        "topology_info":   topo,
        "attack_profile":  atk_profile,
        "summary": {
            "avg_throughput":       avg_thr,
            "avg_delay":            avg_dly,
            "avg_loss":             avg_loss,
            "total_attack_blocked": int(cum_attack_blocked),
            "delivery_rate":        deliv,
            "legit_sent":           cum_legit_sent,
            "legit_received":       cum_legit_recv,
            "peak_throughput":      max(throughput_ts),
            "peak_delay":           max(delay_ts),
            "peak_loss":            max(packet_loss_ts),
            "min_throughput":       min(throughput_ts),
        }
    }

def run_attack_simulation(attack_type: str, defense_mode: str, attack_pps: int,
                          duration: int = 60, topology=None) -> dict:
    """
    Wrapper that runs a simulation with a specific attack type and generates
    NS2-style trace events for real-time playback.
    """
    # Inject attack type into topology
    if topology is None:
        topology = {}
    if isinstance(topology, dict):
        topology['attack_type'] = attack_type
    
    # Run the base simulation
    result = run_simulation(defense_mode, attack_pps, duration, topology)
    
    # Generate trace events from the simulation data for playback
    events = []
    labels = result.get('labels', [])
    attack_traffic = result.get('attack_traffic', [])
    legit_traffic = result.get('legit_traffic', [])
    attack_dropped = result.get('attack_dropped', [])
    legit_passed = result.get('legit_passed', [])
    
    topo = _analyze_topology(topology)
    
    # Get node IDs from topology or use defaults
    nodes = topology.get('nodes', []) if isinstance(topology, dict) else []
    attacker_ids = [n.get('id', 'attacker') for n in nodes if n.get('type') == 'attacker'] or ['attacker']
    server_ids = [n.get('id', 'server') for n in nodes if n.get('type') == 'server'] or ['server']
    router_ids = [n.get('id', 'router') for n in nodes if n.get('type') == 'router'] or ['router']
    
    for i, t in enumerate(labels):
        atk_pps_now = attack_traffic[i] if i < len(attack_traffic) else 0
        leg_pps_now = legit_traffic[i] if i < len(legit_traffic) else 0
        atk_drop_now = attack_dropped[i] if i < len(attack_dropped) else 0
        leg_pass_now = legit_passed[i] if i < len(legit_passed) else 0
        
        atk_from = attacker_ids[0]
        srv_to = server_ids[0]
        rtr = router_ids[0] if router_ids else atk_from
        
        # Generate enqueue events for attack packets
        atk_count = min(int(atk_pps_now / 50), 20)  # Scale down for playback
        for j in range(atk_count):
            jitter = random.uniform(0, 0.8)
            events.append({
                'time': t + jitter,
                'event': '+',
                'from': atk_from,
                'to': rtr,
                'pkt_type': 'tcp' if attack_type in ['syn_flood', 'http_flood', 'slowloris'] else 'udp',
                'size': ATTACK_PROFILES.get(attack_type, ATTACK_PROFILES['syn_flood'])['pkt_size'],
                'fid': '2',
            })
        
        # Generate drop events for blocked packets
        drop_count = min(int(atk_drop_now / 50), 15)
        for j in range(drop_count):
            jitter = random.uniform(0.1, 0.9)
            events.append({
                'time': t + jitter,
                'event': 'd',
                'from': rtr,
                'to': srv_to,
                'pkt_type': 'tcp',
                'size': 60,
                'fid': '2',
            })
        
        # Generate receive events for legitimate traffic
        leg_count = min(int(leg_pass_now / 30), 10)
        for j in range(leg_count):
            jitter = random.uniform(0, 0.8)
            events.append({
                'time': t + jitter,
                'event': 'r',
                'from': rtr,
                'to': srv_to,
                'pkt_type': 'tcp',
                'size': 512,
                'fid': '1',
            })
        
        # Generate enqueue events for legit packets
        leg_enq_count = min(int(leg_pps_now / 30), 8)
        for j in range(leg_enq_count):
            jitter = random.uniform(0, 0.8)
            events.append({
                'time': t + jitter,
                'event': '+',
                'from': srv_to,
                'to': rtr,
                'pkt_type': 'tcp',
                'size': 512,
                'fid': '1',
            })
    
    events.sort(key=lambda e: e['time'])
    result['events'] = events
    result['attack_type'] = attack_type
    result['attack_profile'] = ATTACK_PROFILES.get(attack_type, ATTACK_PROFILES['syn_flood'])
    
    return result


def run_ns2_command(command: str, topology: dict) -> dict:
    """
    Execute NS2-style TCL commands and return network state changes.
    Supports: set, connect, traffic, attack, defense, monitor, ping, traceroute
    """
    cmd = command.strip().lower()
    result = {"output": [], "state_changes": {}, "success": True}

    tokens = command.strip().split()
    if not tokens:
        result["output"] = ["Error: Empty command"]
        result["success"] = False
        return result

    verb = tokens[0].lower()

    # ── set ──
    if verb == "set":
        result["output"] = [
            f"NS2> Variable set: {' '.join(tokens[1:])}",
            f"NS2> OK"
        ]

    # ── ping ──
    elif verb == "ping":
        target = tokens[1] if len(tokens) > 1 else "node3"
        hops = random.randint(2, 8)
        base = random.uniform(2, 15)
        result["output"] = [
            f"NS2> PING {target}: 56 data bytes",
            f"NS2> 64 bytes from {target}: icmp_seq=1 ttl={64-hops} time={base:.1f} ms",
            f"NS2> 64 bytes from {target}: icmp_seq=2 ttl={64-hops} time={base+random.uniform(-1,1):.1f} ms",
            f"NS2> 64 bytes from {target}: icmp_seq=3 ttl={64-hops} time={base+random.uniform(-1,1):.1f} ms",
            f"NS2> --- {target} ping statistics ---",
            f"NS2> 3 packets transmitted, 3 received, 0% packet loss",
            f"NS2> rtt min/avg/max = {base-0.5:.1f}/{base:.1f}/{base+0.5:.1f} ms"
        ]

    # ── traceroute ──
    elif verb == "traceroute" or verb == "tracert":
        target = tokens[1] if len(tokens) > 1 else "node3"
        result["output"] = [f"NS2> traceroute to {target}, 30 hops max:"]
        hops = random.randint(3, 7)
        delay = 1.0
        for i in range(1, hops + 1):
            delay += random.uniform(2, 10)
            result["output"].append(f"NS2>  {i:2d}  node{i} ({10+i}.0.0.{i})  {delay:.1f} ms")
        result["output"].append(f"NS2> Trace complete.")

    # ── attack ──
    elif verb == "attack":
        attack_type = tokens[1] if len(tokens) > 1 else "syn_flood"
        rate = int(tokens[2]) if len(tokens) > 2 else 1000
        target = tokens[3] if len(tokens) > 3 else "node3"
        profile = ATTACK_PROFILES.get(attack_type, ATTACK_PROFILES["syn_flood"])
        result["output"] = [
            f"NS2> [ATTACK] Launching {profile['name']}",
            f"NS2> Target: {target} | Rate: {rate} pps | Pkt size: {profile['pkt_size']} bytes",
            f"NS2> Burst factor: {profile['burst_factor']}x | Estimated BW: {rate * profile['pkt_size'] * 8 / 1000:.0f} Kbps",
            f"NS2> Attack flow FID=2 started at t=0.0",
            f"NS2> [WARN] High traffic detected on ingress interface"
        ]
        result["state_changes"] = {"attack_active": True, "attack_type": attack_type, "attack_rate": rate}

    # ── defense ──
    elif verb == "defense" or verb == "set_defense":
        mode = tokens[1] if len(tokens) > 1 else "dtaf"
        modes = {"none": "No Defense", "static": "Static Threshold (800pps)", "dtaf": "DTAF Adaptive Engine"}
        result["output"] = [
            f"NS2> [DEFENSE] Mode set to: {modes.get(mode, mode)}",
            f"NS2> DTAF Engine: {'enabled' if mode == 'dtaf' else 'disabled'}",
            f"NS2> Static threshold: {'800 pps' if mode == 'static' else 'N/A'}",
            f"NS2> Configuration applied to all router nodes"
        ]
        result["state_changes"] = {"defense_mode": mode}

    # ── connect ──
    elif verb == "connect":
        if len(tokens) >= 3:
            src, dst = tokens[1], tokens[2]
            bw = tokens[3] if len(tokens) > 3 else "100Mb"
            delay_val = tokens[4] if len(tokens) > 4 else "5ms"
            result["output"] = [
                f"NS2> $ns duplex-link ${src} ${dst} {bw} {delay_val} DropTail",
                f"NS2> Link created: {src} <-> {dst}",
                f"NS2> Bandwidth: {bw} | Delay: {delay_val} | Queue: DropTail",
            ]
            result["state_changes"] = {"new_link": {"src": src, "dst": dst}}
        else:
            result["output"] = ["NS2> Error: connect <src> <dst> [bw] [delay]"]

    # ── monitor ──
    elif verb == "monitor":
        node = tokens[1] if len(tokens) > 1 else "all"
        result["output"] = [
            f"NS2> [MONITOR] Sampling node: {node}",
            f"NS2> Throughput: {random.uniform(400, 900):.1f} Kbps",
            f"NS2> Delay:      {random.uniform(2, 20):.2f} ms",
            f"NS2> Queue util: {random.uniform(20, 80):.1f}%",
            f"NS2> Pkts/sec:   {random.randint(100, 500)}",
            f"NS2> Loss rate:  {random.uniform(0.1, 5.0):.2f}%",
        ]

    # ── traffic ──
    elif verb == "traffic":
        flow_type = tokens[1] if len(tokens) > 1 else "cbr"
        rate = tokens[2] if len(tokens) > 2 else "512Kb"
        result["output"] = [
            f"NS2> Traffic agent: {flow_type.upper()}",
            f"NS2> Rate: {rate} | PacketSize: 512 bytes",
            f"NS2> Flow FID=1 (legitimate) started",
        ]

    # ── show / status ──
    elif verb in ("show", "status", "info"):
        nodes = topology.get("nodes", [])
        edges = topology.get("edges", [])
        result["output"] = [
            f"NS2> ===== Network Status =====",
            f"NS2> Nodes:  {len(nodes)}",
            f"NS2> Links:  {len(edges)}",
            f"NS2> Simulation time: {random.uniform(0, 60):.2f}s",
            f"NS2> NS2 version: 2.35 (DTAF-patched)",
        ]
        for n in nodes[:6]:
            ntype = n.get("type", "router")
            prof  = DEVICE_PROFILES.get(ntype, DEVICE_PROFILES["router"])
            result["output"].append(
                f"NS2>   [{n['id']}] {ntype.upper()} | BW:{prof['bw']}Mbps | Delay:{prof['base_delay']}ms"
            )

    # ── reset ──
    elif verb == "reset":
        result["output"] = [
            "NS2> Simulation reset.",
            "NS2> All flows cleared.",
            "NS2> DTAF state reset.",
            "NS2> Queue flushed.",
        ]

    # ── help ──
    elif verb == "help":
        result["output"] = [
            "NS2> Available commands:",
            "NS2>   ping <node>                    - ICMP ping test",
            "NS2>   traceroute <node>              - Trace route to node",
            "NS2>   attack <type> <rate> [target]  - Launch attack simulation",
            "NS2>     Types: syn_flood, udp_flood, icmp_flood, http_flood, slowloris, amplification",
            "NS2>   defense <mode>                 - Set defense mode (none/static/dtaf)",
            "NS2>   connect <src> <dst> [bw] [ms]  - Add network link",
            "NS2>   traffic <type> <rate>          - Configure traffic flow",
            "NS2>   monitor [node]                 - Show live metrics",
            "NS2>   status                         - Show network topology",
            "NS2>   set <var> <value>              - Set NS2 variable",
            "NS2>   reset                          - Reset simulation state",
        ]

    # ── TCL passthrough ──
    elif verb in ("$ns", "proc", "puts", "source", "global", "set"):
        result["output"] = [f"NS2> TCL> {command}", "NS2> OK"]

    else:
        # Try to interpret as TCL-style
        result["output"] = [
            f"NS2> [TCL] Executing: {command}",
            f"NS2> OK"
        ]

    return result


def generate_and_run_dynamic_topology(defense_mode, attack_pps, topology):
    """Run simulation using workspace-defined topology with event generation"""
    attack_type = 'syn_flood'
    if isinstance(topology, dict):
        attack_type = topology.get('attack_type', 'syn_flood')
    return run_attack_simulation(attack_type, defense_mode, attack_pps, 60, topology)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def _std(lst):
    if len(lst) < 2:
        return 0
    m = sum(lst) / len(lst)
    return math.sqrt(sum((x - m) ** 2 for x in lst) / len(lst))

def _sigmoid(x):
    return 1 / (1 + math.exp(-x))
# dtaf_ns2.tcl
# Dynamic Traffic-Aware Filtering (DTAF) Simulation
# Usage: ns dtaf_ns2.tcl <defense_mode>
# defense_mode: none | dtaf

if {$argc != 1} {
    puts "Usage: ns dtaf_ns2.tcl <defense:none|dtaf>"
    exit 1
}

set defense [lindex $argv 0]

set ns [new Simulator]

# Define colors for NAM
$ns color 1 Blue   ;# Legitimate Traffic
$ns color 2 Red    ;# Attack Traffic

# Open trace files
set tracefile [open "out_${defense}.tr" w]
$ns trace-all $tracefile

set namfile [open "out_${defense}.nam" w]
$ns namtrace-all $namfile

# Create nodes
set n0 [$ns node] ;# Legitimate Client
set n1 [$ns node] ;# Attacker
set n2 [$ns node] ;# Router
set n3 [$ns node] ;# Server

# Create links
$ns duplex-link $n0 $n2 10Mb 10ms DropTail
$ns duplex-link $n1 $n2 10Mb 10ms DropTail
$ns duplex-link $n2 $n3 2Mb 20ms DropTail

# Set Queue Size for the bottleneck
$ns queue-limit $n2 $n3 50

# NAM layout
$ns duplex-link-op $n0 $n2 orient right-down
$ns duplex-link-op $n1 $n2 orient right-up
$ns duplex-link-op $n2 $n3 orient right

# --- Legitimate Traffic (Flow ID 1) ---
set udp_legit [new Agent/UDP]
$ns attach-agent $n0 $udp_legit
$udp_legit set fid_ 1

set cbr_legit [new Application/Traffic/CBR]
$cbr_legit attach-agent $udp_legit
$cbr_legit set packetSize_ 1000
$cbr_legit set rate_ 500Kb ;# Normal traffic rate

set sink_legit [new Agent/LossMonitor]
$ns attach-agent $n3 $sink_legit
$ns connect $udp_legit $sink_legit

# --- Attack Traffic (Flow ID 2) ---
set udp_attack [new Agent/UDP]
$ns attach-agent $n1 $udp_attack
$udp_attack set fid_ 2

set cbr_attack [new Application/Traffic/CBR]
$cbr_attack attach-agent $udp_attack
$cbr_attack set packetSize_ 1000
$cbr_attack set rate_ 3Mb ;# High rate DoS attack

set sink_attack [new Agent/LossMonitor]
$ns attach-agent $n3 $sink_attack
$ns connect $udp_attack $sink_attack

# --- DTAF Filtering Mechanism ---
# We use an ErrorModel on the attacker's ingress link to act as our traffic filter.
# When DTAF detects anomalies, it will dynamically drop packets here.
set filter_model [new ErrorModel]
$filter_model set rate_ 0.0 ;# Initial drop rate is 0 (No filtering)
$filter_model drop-target [new Agent/Null]
$ns lossmodel $filter_model $n1 $n2

# DTAF Variables
set ema_rate 0.0
set alpha 0.2
set threshold_factor 1.5
set dynamic_threshold 0.0
set monitoring_interval 0.5
set is_learning 1

proc dtaf_monitor {} {
    global ns sink_legit sink_attack filter_model defense 
    global ema_rate alpha threshold_factor dynamic_threshold monitoring_interval is_learning

    set current_time [$ns now]
    
    # Calculate bytes received in the last interval
    set bytes_legit [$sink_legit set bytes_]
    set bytes_attack [$sink_attack set bytes_]
    set total_bytes [expr $bytes_legit + $bytes_attack]
    
    # Calculate current rate in bps
    set current_rate [expr ($total_bytes * 8.0) / $monitoring_interval]
    
    # Reset bytes for next interval
    $sink_legit set bytes_ 0
    $sink_attack set bytes_ 0

    if {$defense == "dtaf"} {
        if {$is_learning == 1 && $current_time < 9.0} {
            # Learning Phase: Calculate EMA of normal traffic
            if {$ema_rate == 0.0} {
                set ema_rate $current_rate
            } else {
                set ema_rate [expr ($alpha * $current_rate) + ((1.0 - $alpha) * $ema_rate)]
            }
            set dynamic_threshold [expr $ema_rate * $threshold_factor]
        } else {
            set is_learning 0
            # Detection & Filtering Phase
            if {$current_rate > $dynamic_threshold && $dynamic_threshold > 0} {
                # Traffic exceeded adaptive threshold -> Activate Filter
                # We filter out the excess malicious flow to protect the network
                $filter_model set rate_ 0.95 ;# Drop 95% of attack traffic
                puts "Time: $current_time | DTAF: Attack detected! Rate: $current_rate bps > Threshold: $dynamic_threshold bps. Filter ON."
            } else {
                # Traffic is normal -> Disable Filter
                $filter_model set rate_ 0.0
            }
        }
    }

    # Re-schedule monitor
    $ns at [expr $current_time + $monitoring_interval] "dtaf_monitor"
}

# --- Scheduling Events ---
$ns at 1.0 "$cbr_legit start"
$ns at 10.0 "$cbr_attack start" ;# Attack begins
$ns at 40.0 "$cbr_attack stop"  ;# Attack ends
$ns at 50.0 "$cbr_legit stop"

# Start the monitor
$ns at 1.0 "dtaf_monitor"

# Finish procedure
proc finish {} {
    global ns tracefile namfile
    $ns flush-trace
    close $tracefile
    close $namfile
    exit 0
}

$ns at 51.0 "finish"

puts "Starting NS2 Simulation with Defense Mode: $defense..."
$ns run

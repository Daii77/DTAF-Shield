# dtaf_ns2_web.tcl
# Web-integrated NS2 DTAF Simulation
# Usage: ns dtaf_ns2_web.tcl <defense:none|static|dtaf> <attack_pps>

if {$argc != 2} {
    puts "Usage: ns dtaf_ns2_web.tcl <defense:none|static|dtaf> <attack_pps>"
    exit 1
}

set defense [lindex $argv 0]
set attack_pps [lindex $argv 1]

set ns [new Simulator]

# Open trace file
set tracefile [open "out_web.tr" w]
$ns trace-all $tracefile

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

# --- Legitimate Traffic (Flow ID 1) ---
set udp_legit [new Agent/UDP]
$ns attach-agent $n0 $udp_legit
$udp_legit set fid_ 1

set cbr_legit [new Application/Traffic/CBR]
$cbr_legit attach-agent $udp_legit
$cbr_legit set packetSize_ 1000
$cbr_legit set rate_ 500Kb ;# Normal traffic rate (approx 62 PPS)

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

if {$attack_pps > 0} {
    set attack_rate [expr $attack_pps * 1000 * 8] 
    $cbr_attack set rate_ ${attack_rate}bps
} else {
    $cbr_attack set rate_ 0bps
}

set sink_attack [new Agent/LossMonitor]
$ns attach-agent $n3 $sink_attack
$ns connect $udp_attack $sink_attack

# --- Defense Mechanism ---
set filter_model [new ErrorModel]
$filter_model set rate_ 0.0 ;# Initial drop rate is 0
$filter_model drop-target [new Agent/Null]
$ns lossmodel $filter_model $n1 $n2

# Variables
set ema_rate 0.0
set alpha 0.2
set threshold_factor 1.5
set dynamic_threshold 0.0
set static_threshold 800000.0 ;# 800 Kbps static limit
set monitoring_interval 0.5
set is_learning 1

proc network_monitor {} {
    global ns sink_legit sink_attack filter_model defense 
    global ema_rate alpha threshold_factor dynamic_threshold static_threshold monitoring_interval is_learning

    set current_time [$ns now]
    
    set bytes_legit [$sink_legit set bytes_]
    set bytes_attack [$sink_attack set bytes_]
    set total_bytes [expr $bytes_legit + $bytes_attack]
    set current_rate [expr ($total_bytes * 8.0) / $monitoring_interval]
    
    $sink_legit set bytes_ 0
    $sink_attack set bytes_ 0

    if {$defense == "dtaf"} {
        if {$is_learning == 1 && $current_time < 9.0} {
            if {$ema_rate == 0.0} {
                set ema_rate $current_rate
            } else {
                set ema_rate [expr ($alpha * $current_rate) + ((1.0 - $alpha) * $ema_rate)]
            }
            set dynamic_threshold [expr $ema_rate * $threshold_factor]
        } else {
            set is_learning 0
            if {$current_rate > $dynamic_threshold && $dynamic_threshold > 0} {
                $filter_model set rate_ 0.98 ;# High precision drop
            } else {
                $filter_model set rate_ 0.0
            }
        }
    } elseif {$defense == "static"} {
        if {$current_rate > $static_threshold} {
            # Static defense drops roughly proportionally
            set drop_ratio [expr ($current_rate - $static_threshold) / $current_rate]
            if {$drop_ratio > 0.9} { set drop_ratio 0.9 }
            $filter_model set rate_ $drop_ratio
        } else {
            $filter_model set rate_ 0.0
        }
    }

    $ns at [expr $current_time + $monitoring_interval] "network_monitor"
}

# --- Scheduling Events ---
# Total simulation is 60 seconds matching the dashboard
$ns at 1.0 "$cbr_legit start"
if {$attack_pps > 0} {
    $ns at 10.0 "$cbr_attack start"
    $ns at 50.0 "$cbr_attack stop"
}
$ns at 60.0 "$cbr_legit stop"

$ns at 1.0 "network_monitor"

proc finish {} {
    global ns tracefile
    $ns flush-trace
    close $tracefile
    exit 0
}

$ns at 61.0 "finish"
$ns run

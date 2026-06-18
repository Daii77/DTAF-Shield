# run_dtaf.tcl
# Usage:
#   ./ns run_dtaf.tcl <defense> <attack_pps> <outprefix> [show_nam]
# defense: none | static | dtaf
# attack_pps: 0 / 200 / 500 / 1000
# outprefix: dtaf_project/results/run1
# show_nam: 0 or 1 (optional, default 0)

if {$argc < 3} {
    puts "Usage: ns run_dtaf.tcl <defense:none|static|dtaf> <attack_pps> <outprefix> [show_nam]"
    exit 1
}

set defense   [lindex $argv 0]
set attackpps [expr int([lindex $argv 1])]
set outpre    [lindex $argv 2]

set showNam 0
if {$argc >= 4} {
    set showNam [expr int([lindex $argv 3])]
}

set simTime 60.0
set attackStart 10.0

# Create simulator
set ns [new Simulator]

# Trace
set tr [open "${outpre}.tr" w]
$ns trace-all $tr

# NAM trace
set nf [open "${outpre}.nam" w]
$ns namtrace-all $nf

# Nodes (20 nodes total per scenarios)
set N 20
for {set i 0} {$i < $N} {incr i} {
    set n($i) [$ns node]
}

# Active topology: n0 legit src, n1 attacker, n2 router, n3 sink
$ns duplex-link $n(0) $n(2) 10Mb 10ms DropTail
$ns duplex-link $n(1) $n(2) 10Mb 10ms DropTail
$ns duplex-link $n(2) $n(3) 2Mb 20ms DTAF

# Get queue object on link (2->3)
set link_23 [$ns link $n(2) $n(3)]
set q23 [$link_23 queue]

# Configure defense
if {$defense == "none"} {
    $q23 set mode_ 2
} elseif {$defense == "static"} {
    $q23 set mode_ 1
    $q23 set static_threshold_ 250.0
} elseif {$defense == "dtaf"} {
    $q23 set mode_ 0
    $q23 set measure_interval_ 1.0
    $q23 set adjustment_factor_ 2.0
    $q23 set ema_alpha_ 0.2
} else {
    puts "Invalid defense: $defense"
    exit 1
}

# Enable DTAF log
$q23 logfile "${outpre}.dtaf.log"

# Legit traffic: 50 Kbps
set udp_leg [new Agent/UDP]
$udp_leg set fid_ 1
$ns attach-agent $n(0) $udp_leg

set null_leg [new Agent/Null]
$ns attach-agent $n(3) $null_leg
$ns connect $udp_leg $null_leg

set cbr_leg [new Application/Traffic/CBR]
$cbr_leg set packetSize_ 1000
$cbr_leg set rate_ 50Kb
$cbr_leg attach-agent $udp_leg

# Attack traffic
set udp_att [new Agent/UDP]
$udp_att set fid_ 2
$ns attach-agent $n(1) $udp_att

set null_att [new Agent/Null]
$ns attach-agent $n(3) $null_att
$ns connect $udp_att $null_att

set cbr_att [new Application/Traffic/CBR]
$cbr_att set packetSize_ 512
if {$attackpps > 0} {
    set interval [expr 1.0 / double($attackpps)]
    $cbr_att set interval_ $interval
} else {
    $cbr_att set interval_ 1.0
}
$cbr_att attach-agent $udp_att

# NAM layout hints
$ns duplex-link-op $n(0) $n(2) orient right-down
$ns duplex-link-op $n(1) $n(2) orient right-up
$ns duplex-link-op $n(2) $n(3) orient right

# Schedule
$ns at 0.5 "$cbr_leg start"
if {$attackpps > 0} {
    $ns at $attackStart "$cbr_att start"
}
$ns at $simTime "finish"

proc finish {} {
    global ns tr nf outpre showNam
    $ns flush-trace
    close $tr
    close $nf
    puts "Done. Trace: ${outpre}.tr  NAM: ${outpre}.nam  DTAF log: ${outpre}.dtaf.log"
    if {$showNam == 1} {
        exec nam "${outpre}.nam" &
    }
    exit 0
}

$ns run

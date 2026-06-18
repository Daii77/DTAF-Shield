/* DTAF Shield — Workspace Canvas Engine v2.0
   Real-Time Network Visualization with Full Command Support
   ========================================================= */
(function () {
    const canvas = document.getElementById('workspaceCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // ══════════════════════════════════════════════════════════
    //  STATE
    // ══════════════════════════════════════════════════════════
    let nodes = [];
    let links = [];
    let selectedNode = null;
    let connectingFrom = null;
    let tool = 'select';
    let zoom = 1;
    let panX = 0, panY = 0;
    let isDragging = false;
    let dragNode = null;
    let dragOffX = 0, dragOffY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let nodeCounter = 0;
    let helpShown = true;

    // Simulation & Particle State
    let simulationEvents = [];
    let simPlaybackInterval = null;
    let currentPlaybackTime = 0;
    let particles = [];
    let isAnimating = false;

    // ══════════════════════════════════════════════════════════
    //  NODE STATE SYSTEM
    // ══════════════════════════════════════════════════════════
    const nodeStates = {};   // nodeId -> { state, health, effects[], shield, firewall, monitor, idsActive }
    const linkEffects = {};  // linkId -> { effects[] }
    const activeAttacks = {}; // attackId -> { from, to, pps, type, intervalId }
    const eventLog = [];      // Array of {time, type, message}
    let globalMonitoring = false;
    let globalIDS = false;
    let globalDTAF = false;

    function generateDefaultInterfaces(type, nodeNum) {
        const ifaces = {};
        if (type === 'router') {
            const subnetNum = nodeNum || 1;
            ifaces["FastEthernet0/0"] = { name: "FastEthernet0/0", ip: `10.0.${subnetNum}.1`, subnet: "255.255.255.0", status: "up", connectedTo: null };
            ifaces["FastEthernet0/1"] = { name: "FastEthernet0/1", ip: `192.168.${subnetNum}.1`, subnet: "255.255.255.0", status: "up", connectedTo: null };
            ifaces["GigabitEthernet0/0"] = { name: "GigabitEthernet0/0", ip: `172.16.${subnetNum}.1`, subnet: "255.255.255.0", status: "up", connectedTo: null };
        } else if (type === 'switch') {
            for (let i = 1; i <= 24; i++) {
                ifaces[`FastEthernet0/${i}`] = { name: `FastEthernet0/${i}`, ip: "N/A", subnet: "N/A", status: "up", connectedTo: null };
            }
        } else if (type === 'server') {
            ifaces["eth0"] = { name: "eth0", ip: "192.168.1.10", subnet: "255.255.255.0", status: "up", connectedTo: null };
        } else if (type === 'client') {
            const idx = 100 + (nodeNum || 1);
            ifaces["eth0"] = { name: "eth0", ip: `192.168.1.${idx}`, subnet: "255.255.255.0", status: "up", connectedTo: null };
        } else if (type === 'attacker') {
            const idx = 100 + (nodeNum || 1);
            ifaces["eth0"] = { name: "eth0", ip: `172.16.1.${idx}`, subnet: "255.255.255.0", status: "up", connectedTo: null };
        } else if (type === 'firewall') {
            ifaces["eth0"] = { name: "eth0", ip: "10.0.1.254", subnet: "255.255.255.0", status: "up", connectedTo: null };
            ifaces["eth1"] = { name: "eth1", ip: "192.168.1.254", subnet: "255.255.255.0", status: "up", connectedTo: null };
        } else {
            ifaces["eth0"] = { name: "eth0", ip: "10.0.0.2", subnet: "255.255.255.0", status: "up", connectedTo: null };
        }
        return ifaces;
    }

    function generateDefaultRoutes(type, nodeNum) {
        const subnetNum = nodeNum || 1;
        if (type === 'server' || type === 'client') {
            return [{ dest: "0.0.0.0", mask: "0.0.0.0", gw: `192.168.${subnetNum}.1` }];
        }
        if (type === 'attacker') {
            return [{ dest: "0.0.0.0", mask: "0.0.0.0", gw: `172.16.${subnetNum}.1` }];
        }
        if (type === 'firewall') {
            return [{ dest: "0.0.0.0", mask: "0.0.0.0", gw: `10.0.${subnetNum}.1` }];
        }
        return [];
    }

    function allocateInterfaces(link) {
        const fromNode = nodes.find(n => n.id === link.from);
        const toNode = nodes.find(n => n.id === link.to);
        if (!fromNode || !toNode) return;

        const fromState = getNodeState(fromNode.id);
        const toState = getNodeState(toNode.id);

        let fromIfName = null;
        if (fromState.interfaces) {
            for (const name in fromState.interfaces) {
                if (fromState.interfaces[name].connectedTo === null) {
                    fromIfName = name;
                    break;
                }
            }
        }

        let toIfName = null;
        if (toState.interfaces) {
            for (const name in toState.interfaces) {
                if (toState.interfaces[name].connectedTo === null) {
                    toIfName = name;
                    break;
                }
            }
        }

        if (!fromIfName) {
            fromIfName = `eth${Object.keys(fromState.interfaces || {}).length}`;
            if (!fromState.interfaces) fromState.interfaces = {};
            fromState.interfaces[fromIfName] = { name: fromIfName, ip: "N/A", subnet: "N/A", status: "up", connectedTo: null };
        }
        if (!toIfName) {
            toIfName = `eth${Object.keys(toState.interfaces || {}).length}`;
            if (!toState.interfaces) toState.interfaces = {};
            toState.interfaces[toIfName] = { name: toIfName, ip: "N/A", subnet: "N/A", status: "up", connectedTo: null };
        }

        fromState.interfaces[fromIfName].connectedTo = { nodeId: toNode.id, interface: toIfName };
        toState.interfaces[toIfName].connectedTo = { nodeId: fromNode.id, interface: fromIfName };

        link.fromInterface = fromIfName;
        link.toInterface = toIfName;
    }

    function freeInterfaces(link) {
        if (!link) return;
        const fromState = nodeStates[link.from];
        const toState = nodeStates[link.to];

        if (fromState && fromState.interfaces && link.fromInterface && fromState.interfaces[link.fromInterface]) {
            fromState.interfaces[link.fromInterface].connectedTo = null;
        }
        if (toState && toState.interfaces && link.toInterface && toState.interfaces[link.toInterface]) {
            toState.interfaces[link.toInterface].connectedTo = null;
        }
    }

    function getNodeState(nodeId) {
        if (!nodeStates[nodeId]) {
            const node = nodes.find(n => n.id === nodeId);
            const type = node ? node.type : 'router';
            const num = node ? (parseInt(node.id.replace('n_','')) || 1) : 1;
            
            if (node) {
                if (!node.interfaces) node.interfaces = generateDefaultInterfaces(type, num);
                if (!node.routes) node.routes = generateDefaultRoutes(type, num);
                if (!node.accessLists) node.accessLists = [];
            }

            nodeStates[nodeId] = {
                state: 'normal',  // normal|scanning|under_attack|compromised|protected|defending|blocked|quarantined
                health: 100,
                effects: [],
                shield: false,
                firewall: false,
                monitor: false,
                idsActive: false,
                rateLimit: 0,
                ports: generateRandomPorts(),
                os: pickRandom(['Linux 5.15', 'Windows Server 2022', 'Ubuntu 22.04', 'FreeBSD 13', 'CentOS 8']),
                services: pickRandom([['HTTP','SSH','DNS'], ['HTTPS','FTP','SMTP'], ['HTTP','MySQL','SSH'], ['DNS','DHCP','NTP']])
            };
        }
        
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
            nodeStates[nodeId].interfaces = node.interfaces;
            nodeStates[nodeId].routes = node.routes;
            nodeStates[nodeId].accessLists = node.accessLists;
        }

        return nodeStates[nodeId];
    }

    function getLinkEffect(linkId) {
        if (!linkEffects[linkId]) {
            linkEffects[linkId] = { effects: [] };
        }
        return linkEffects[linkId];
    }

    function generateRandomPorts() {
        const common = [22, 80, 443, 8080, 3306, 53, 25, 110, 143, 993, 21, 23, 3389, 5432, 6379, 27017];
        const count = 2 + Math.floor(Math.random() * 5);
        const ports = [];
        for (let i = 0; i < count; i++) {
            ports.push(common[Math.floor(Math.random() * common.length)]);
        }
        return [...new Set(ports)].sort((a, b) => a - b);
    }

    function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    function logEvent(type, message) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString();
        eventLog.push({ time: timeStr, type, message });
        if (eventLog.length > 200) eventLog.shift();
    }

    // ══════════════════════════════════════════════════════════
    //  VISUAL EFFECTS ENGINE
    // ══════════════════════════════════════════════════════════

    function addNodeEffect(nodeId, effect) {
        const state = getNodeState(nodeId);
        effect.startTime = Date.now();
        effect.id = 'eff_' + Math.random().toString(36).substr(2, 6);
        state.effects.push(effect);
        ensureAnimating();
    }

    function addLinkEffect(linkId, effect) {
        const le = getLinkEffect(linkId);
        effect.startTime = Date.now();
        effect.id = 'eff_' + Math.random().toString(36).substr(2, 6);
        le.effects.push(effect);
        ensureAnimating();
    }

    function clearNodeEffects(nodeId) {
        const state = getNodeState(nodeId);
        state.effects = [];
    }

    function clearAllEffects() {
        Object.keys(nodeStates).forEach(id => {
            nodeStates[id].effects = [];
            nodeStates[id].state = 'normal';
            nodeStates[id].health = 100;
            nodeStates[id].shield = false;
            nodeStates[id].firewall = false;
            nodeStates[id].monitor = false;
        });
        Object.keys(linkEffects).forEach(id => {
            linkEffects[id].effects = [];
        });
        Object.keys(activeAttacks).forEach(id => {
            if (activeAttacks[id].intervalId) clearInterval(activeAttacks[id].intervalId);
            delete activeAttacks[id];
        });
    }

    function ensureAnimating() {
        if (!isAnimating) {
            isAnimating = true;
            animateLoop();
        }
    }

    // Node visual config
    const NODE_R = 28;
    const nodeConfig = {
        router:   { color:'#6366f1', border:'#8183f4', bg:'rgba(99,102,241,0.15)',  label:'Router',    icon:'⬡' },
        switch:   { color:'#0ea5e9', border:'#38bdf8', bg:'rgba(14,165,233,0.15)',  label:'Switch',    icon:'◈' },
        server:   { color:'#10b981', border:'#34d399', bg:'rgba(16,185,129,0.15)',  label:'Server',    icon:'▪' },
        client:   { color:'#94a3b8', border:'#cbd5e1', bg:'rgba(148,163,184,0.15)', label:'Client',    icon:'●' },
        attacker: { color:'#ef4444', border:'#f87171', bg:'rgba(239,68,68,0.15)',   label:'Attacker',  icon:'✖' },
        firewall: { color:'#f59e0b', border:'#fbbf24', bg:'rgba(245,158,11,0.15)',  label:'Firewall',  icon:'◆' },
    };

    const nodeImages = {};
    const svgDefinitions = {
        router: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M32 2a30 30 0 1030 30A30 30 0 0032 2zm0 56a26 26 0 1126-26 26 26 0 01-26 26z"/><path fill="currentColor" d="M32 10a22 22 0 1022 22 22 22 0 00-22-22zm0 40a18 18 0 1118-18 18 18 0 01-18 18z"/><circle fill="currentColor" cx="32" cy="32" r="10"/><path fill="currentColor" d="M30 4h4v10h-4zM30 50h4v10h-4zM50 30h10v4H50zM4 30h10v4H4z"/></svg>`,
        switch: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="16" width="56" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="16" cy="32" r="4" fill="currentColor"/><circle cx="32" cy="32" r="4" fill="currentColor"/><circle cx="48" cy="32" r="4" fill="currentColor"/><path d="M12 24h40M12 40h40" stroke="currentColor" stroke-width="2"/></svg>`,
        server: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="4" width="40" height="56" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><path d="M12 20h40M12 32h40M12 44h40" stroke="currentColor" stroke-width="4"/><circle cx="20" cy="12" r="2" fill="currentColor"/><circle cx="20" cy="26" r="2" fill="currentColor"/><circle cx="20" cy="38" r="2" fill="currentColor"/><circle cx="20" cy="50" r="2" fill="currentColor"/><rect x="28" y="10" width="16" height="4" fill="currentColor"/><rect x="28" y="24" width="16" height="4" fill="currentColor"/><rect x="28" y="36" width="16" height="4" fill="currentColor"/><rect x="28" y="48" width="16" height="4" fill="currentColor"/></svg>`,
        client: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M8 12h48v30H8z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M32 42v10M16 52h32" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="52" r="2" fill="currentColor"/></svg>`,
        firewall: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M32 2L8 12v16c0 18 16 30 24 34 8-4 24-16 24-34V12z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M20 32l8 8 16-16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        attacker: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M32 2A30 30 0 1 0 32 62 30 30 0 1 0 32 2Z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M20 20l24 24M44 20L20 44" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>`
    };

    Object.keys(svgDefinitions).forEach(type => {
        const color = nodeConfig[type].border || '#ffffff';
        const coloredSvg = svgDefinitions[type].replace(/currentColor/g, color);
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(coloredSvg);
        nodeImages[type] = img;
    });

    // State-based color overrides
    const stateColors = {
        normal:       null,
        scanning:     { border: '#3b82f6', bg: 'rgba(59,130,246,0.2)',  glow: '#3b82f6' },
        under_attack: { border: '#ef4444', bg: 'rgba(239,68,68,0.25)',  glow: '#ef4444' },
        compromised:  { border: '#991b1b', bg: 'rgba(153,27,27,0.3)',   glow: '#dc2626' },
        protected:    { border: '#10b981', bg: 'rgba(16,185,129,0.2)',  glow: '#10b981' },
        defending:    { border: '#059669', bg: 'rgba(5,150,105,0.25)',  glow: '#34d399' },
        blocked:      { border: '#6b7280', bg: 'rgba(107,114,128,0.2)', glow: '#6b7280' },
        quarantined:  { border: '#f97316', bg: 'rgba(249,115,22,0.2)', glow: '#f97316' },
        monitoring:   { border: '#eab308', bg: 'rgba(234,179,8,0.15)', glow: '#eab308' },
    };

    // ══════════════════════════════════════════════════════════
    //  RESIZE
    // ══════════════════════════════════════════════════════════
    function resize() {
        const container = document.getElementById('canvasContainer');
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        draw();
    }
    window.addEventListener('resize', resize);
    resize();

    // ══════════════════════════════════════════════════════════
    //  COORD HELPERS
    // ══════════════════════════════════════════════════════════
    function screenToCanvas(sx, sy) {
        return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
    }
    function getRect() { return canvas.getBoundingClientRect(); }
    function evPos(e) {
        const r = getRect();
        const cx = (e.clientX||e.touches?.[0]?.clientX||0) - r.left;
        const cy = (e.clientY||e.touches?.[0]?.clientY||0) - r.top;
        return screenToCanvas(cx, cy);
    }
    function nodeAt(pos) {
        return nodes.slice().reverse().find(n => Math.hypot(n.x-pos.x, n.y-pos.y) <= NODE_R * 1.2);
    }

    // BFS path finder
    function findPath(fromId, toId) {
        const adj = {};
        nodes.forEach(n => adj[n.id] = []);
        links.forEach(l => {
            if (adj[l.from]) adj[l.from].push(l.to);
            if (adj[l.to]) adj[l.to].push(l.from);
        });
        const visited = new Set();
        const queue = [[fromId]];
        visited.add(fromId);
        while (queue.length) {
            const path = queue.shift();
            const last = path[path.length - 1];
            if (last === toId) return path;
            for (const neighbor of (adj[last] || [])) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push([...path, neighbor]);
                }
            }
        }
        return null;
    }

    // Find link between two nodes
    function findLinkBetween(a, b) {
        return links.find(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
    }

    // ══════════════════════════════════════════════════════════
    //  DRAW ENGINE (Enhanced with State & Effects)
    // ══════════════════════════════════════════════════════════
    let connectingPreview = null;
    const now = () => Date.now();

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);

        // Draw links
        links.forEach(l => drawLink(l));

        // Connecting preview line
        if (connectingFrom) {
            const n = nodes.find(n => n.id === connectingFrom);
            if (n && connectingPreview) {
                ctx.beginPath();
                ctx.moveTo(n.x, n.y);
                ctx.lineTo(connectingPreview.x, connectingPreview.y);
                ctx.strokeStyle = 'rgba(16,185,129,0.6)';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // Draw nodes
        nodes.forEach(n => drawNode(n));

        // Draw Particles
        drawParticles();

        ctx.restore();
    }

    function drawLink(l) {
        const a = nodes.find(n => n.id === l.from);
        const b = nodes.find(n => n.id === l.to);
        if (!a || !b) return;

        const le = linkEffects[l.id];
        let linkColor = 'rgba(99,102,241,0.35)';
        let linkWidth = 2;
        let dashPattern = [7, 4];

        // Check for link effects
        if (le && le.effects.length > 0) {
            const t = now();
            le.effects = le.effects.filter(eff => {
                if (eff.duration && (t - eff.startTime > eff.duration)) return false;
                return true;
            });

            le.effects.forEach(eff => {
                if (eff.type === 'attack_flow') {
                    linkColor = 'rgba(239,68,68,0.7)';
                    linkWidth = 3;
                    dashPattern = [3, 3];
                    // Draw flowing attack particles along link
                    const elapsed = (t - eff.startTime) / 1000;
                    for (let i = 0; i < 5; i++) {
                        const prog = ((elapsed * 2 + i * 0.2) % 1);
                        const px = a.x + (b.x - a.x) * prog;
                        const py = a.y + (b.y - a.y) * prog;
                        ctx.beginPath();
                        ctx.arc(px, py, 3, 0, Math.PI * 2);
                        ctx.fillStyle = '#ef4444';
                        ctx.fill();
                    }
                } else if (eff.type === 'highlight') {
                    linkColor = eff.color || 'rgba(59,130,246,0.8)';
                    linkWidth = 4;
                    dashPattern = [];
                    // Glow
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.strokeStyle = eff.color || '#3b82f6';
                    ctx.lineWidth = 8;
                    ctx.globalAlpha = 0.2 + 0.1 * Math.sin(t / 300);
                    ctx.stroke();
                    ctx.restore();
                } else if (eff.type === 'blocked') {
                    linkColor = 'rgba(107,114,128,0.5)';
                    linkWidth = 2;
                    // Draw X at midpoint
                    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                    ctx.save();
                    ctx.strokeStyle = '#ef4444';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(mx - 8, my - 8); ctx.lineTo(mx + 8, my + 8);
                    ctx.moveTo(mx + 8, my - 8); ctx.lineTo(mx - 8, my + 8);
                    ctx.stroke();
                    ctx.restore();
                } else if (eff.type === 'traffic_flow') {
                    const elapsed = (t - eff.startTime) / 1000;
                    for (let i = 0; i < 3; i++) {
                        const prog = ((elapsed * 1.5 + i * 0.33) % 1);
                        const px = a.x + (b.x - a.x) * prog;
                        const py = a.y + (b.y - a.y) * prog;
                        ctx.beginPath();
                        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
                        ctx.fillStyle = eff.color || '#10b981';
                        ctx.fill();
                    }
                } else if (eff.type === 'mitm') {
                    linkColor = 'rgba(168,85,247,0.7)';
                    linkWidth = 3;
                    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                    // Draw interceptor icon
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(mx, my, 12, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(168,85,247,0.3)';
                    ctx.fill();
                    ctx.strokeStyle = '#a855f7';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.font = 'bold 10px sans-serif';
                    ctx.fillStyle = '#a855f7';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('👁', mx, my);
                    ctx.restore();
                }
            });
        }

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = linkColor;
        ctx.lineWidth = linkWidth;
        if (dashPattern.length) ctx.setLineDash(dashPattern);
        ctx.stroke();
        ctx.setLineDash([]);

        // Midpoint dot
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fillStyle = linkColor.replace('0.35', '0.5');
        ctx.fill();
    }

    function drawNode(n) {
        const cfg = nodeConfig[n.type] || nodeConfig.router;
        const ns = getNodeState(n.id);
        const isSelected = selectedNode?.id === n.id;
        const isConnecting = connectingFrom === n.id;
        const t = now();

        // Apply shake effect
        let shakeX = 0, shakeY = 0;
        ns.effects.forEach(eff => {
            if (eff.type === 'shake') {
                const elapsed = t - eff.startTime;
                if (elapsed < (eff.duration || 2000)) {
                    const intensity = eff.amplitude || 5;
                    const decay = 1 - elapsed / (eff.duration || 2000);
                    shakeX = (Math.random() - 0.5) * intensity * 2 * decay;
                    shakeY = (Math.random() - 0.5) * intensity * 2 * decay;
                }
            }
        });

        const dx = n.x + shakeX;
        const dy = n.y + shakeY;

        // Remove expired effects
        ns.effects = ns.effects.filter(eff => {
            if (eff.duration && (t - eff.startTime > eff.duration)) return false;
            return true;
        });

        // State-based coloring
        const sc = stateColors[ns.state];
        const borderColor = sc ? sc.border : (isSelected ? cfg.color : cfg.border);
        const bgColor = sc ? sc.bg : cfg.bg;

        // Draw state-specific effects BEHIND the node
        drawNodeStateEffects(n, dx, dy, ns, t);

        // Glow ring (selection/connection)
        if (isSelected || isConnecting) {
            const glowColor = isConnecting ? '#10b981' : (sc ? sc.glow : cfg.color);
            ctx.beginPath(); ctx.arc(dx, dy, NODE_R + 10, 0, Math.PI * 2);
            ctx.fillStyle = glowColor + '18'; ctx.fill();
            ctx.beginPath(); ctx.arc(dx, dy, NODE_R + 6, 0, Math.PI * 2);
            ctx.strokeStyle = glowColor + '60'; ctx.lineWidth = 2; ctx.stroke();
        }

        // Background circle
        ctx.beginPath(); ctx.arc(dx, dy, NODE_R, 0, Math.PI * 2);
        ctx.fillStyle = bgColor; ctx.fill();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();

        // Icon Rendering
        let icon = cfg.icon;
        if (ns.state === 'compromised') {
            ctx.font = 'bold 24px sans-serif';
            ctx.fillStyle = sc ? sc.border : cfg.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('☠', dx, dy);
        } else if (ns.state === 'blocked') {
            ctx.font = 'bold 24px sans-serif';
            ctx.fillStyle = sc ? sc.border : cfg.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⊘', dx, dy);
        } else {
            const img = nodeImages[n.type];
            if (img && img.complete) {
                const imgSize = NODE_R * 1.4;
                // Add a slight drop shadow to the SVG for realism
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 4;
                ctx.shadowOffsetY = 2;
                ctx.drawImage(img, dx - imgSize/2, dy - imgSize/2, imgSize, imgSize);
                ctx.restore();
            } else {
                ctx.font = 'bold 16px sans-serif';
                ctx.fillStyle = sc ? sc.border : cfg.color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(icon, dx, dy);
            }
        }

        // Label
        ctx.font = '600 10px Space Grotesk, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const lbl = n.label || cfg.label;
        ctx.fillText(lbl, dx, dy + NODE_R + 14);

        // Type badge
        ctx.font = 'bold 8px JetBrains Mono, monospace';
        ctx.fillStyle = sc ? sc.border : cfg.color;
        ctx.fillText(n.type.toUpperCase().slice(0, 3), dx, dy + NODE_R + 24);

        // Health bar (shown if health < 100 or under attack)
        if (ns.health < 100 || ns.state === 'under_attack' || ns.state === 'compromised') {
            const barW = 40, barH = 4;
            const barX = dx - barW / 2, barY = dy + NODE_R + 28;
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(barX, barY, barW, barH);
            const healthPct = Math.max(0, ns.health) / 100;
            let healthColor = '#10b981';
            if (healthPct < 0.3) healthColor = '#ef4444';
            else if (healthPct < 0.6) healthColor = '#f59e0b';
            ctx.fillStyle = healthColor;
            ctx.fillRect(barX, barY, barW * healthPct, barH);
        }

        // Status badges (top-right of node)
        drawStatusBadges(dx, dy, ns);

        // Draw active effects ON TOP of node
        drawNodeTopEffects(n, dx, dy, ns, t);
    }

    function drawNodeStateEffects(n, dx, dy, ns, t) {
        // Effects rendered behind/around the node

        // Pulse effects
        ns.effects.forEach(eff => {
            if (eff.type === 'pulse') {
                const elapsed = t - eff.startTime;
                const dur = eff.duration || 2000;
                const count = eff.count || 3;
                for (let i = 0; i < count; i++) {
                    const phase = (elapsed / dur + i / count) % 1;
                    const radius = NODE_R + phase * 40;
                    const alpha = (1 - phase) * 0.6;
                    ctx.beginPath();
                    ctx.arc(dx, dy, radius, 0, Math.PI * 2);
                    ctx.strokeStyle = eff.color || '#3b82f6';
                    ctx.lineWidth = 2;
                    ctx.globalAlpha = alpha;
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
            }
        });

        // Scan sweep effect
        ns.effects.forEach(eff => {
            if (eff.type === 'scan') {
                const elapsed = t - eff.startTime;
                const dur = eff.duration || 3000;
                const angle = (elapsed / 1000) * Math.PI * 2;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(dx, dy);
                ctx.arc(dx, dy, NODE_R + 25, angle, angle + Math.PI / 3);
                ctx.closePath();
                ctx.fillStyle = 'rgba(59,130,246,0.15)';
                ctx.fill();
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(dx, dy);
                const ex = dx + Math.cos(angle) * (NODE_R + 25);
                const ey = dy + Math.sin(angle) * (NODE_R + 25);
                ctx.lineTo(ex, ey);
                ctx.stroke();
                ctx.restore();
            }
        });

        // Fire effect (under_attack continuous)
        if (ns.state === 'under_attack' || ns.state === 'compromised') {
            const flicker = 0.5 + 0.5 * Math.sin(t / 100);
            ctx.save();
            const gradient = ctx.createRadialGradient(dx, dy, NODE_R - 5, dx, dy, NODE_R + 20);
            gradient.addColorStop(0, `rgba(239,68,68,${0.15 * flicker})`);
            gradient.addColorStop(1, 'rgba(239,68,68,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(dx, dy, NODE_R + 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Shield effect
        if (ns.shield || ns.state === 'protected' || ns.state === 'defending') {
            const pulse = 0.8 + 0.2 * Math.sin(t / 500);
            ctx.save();
            ctx.beginPath();
            ctx.arc(dx, dy, NODE_R + 8, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(16,185,129,${0.6 * pulse})`;
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 4]);
            const dashOffset = (t / 50) % 24;
            ctx.lineDashOffset = -dashOffset;
            ctx.stroke();
            ctx.setLineDash([]);
            // Inner shield glow
            const grad = ctx.createRadialGradient(dx, dy, NODE_R, dx, dy, NODE_R + 12);
            grad.addColorStop(0, `rgba(16,185,129,${0.1 * pulse})`);
            grad.addColorStop(1, 'rgba(16,185,129,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(dx, dy, NODE_R + 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Quarantine dashed ring
        if (ns.state === 'quarantined') {
            ctx.save();
            ctx.beginPath();
            ctx.arc(dx, dy, NODE_R + 12, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(249,115,22,0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            const offset = (t / 80) % 20;
            ctx.lineDashOffset = offset;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        // Monitoring radar
        if (ns.monitor || ns.state === 'monitoring') {
            const angle = (t / 2000) * Math.PI * 2;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(dx, dy);
            ctx.arc(dx, dy, NODE_R + 18, angle, angle + 0.5);
            ctx.closePath();
            ctx.fillStyle = 'rgba(234,179,8,0.12)';
            ctx.fill();
            ctx.restore();
        }

        // Firewall barrier lines
        if (ns.firewall) {
            ctx.save();
            ctx.strokeStyle = 'rgba(245,158,11,0.5)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2 + (t / 3000);
                const x1 = dx + Math.cos(angle) * (NODE_R + 4);
                const y1 = dy + Math.sin(angle) * (NODE_R + 4);
                const x2 = dx + Math.cos(angle) * (NODE_R + 10);
                const y2 = dy + Math.sin(angle) * (NODE_R + 10);
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    function drawNodeTopEffects(n, dx, dy, ns, t) {
        // Highlight flash
        ns.effects.forEach(eff => {
            if (eff.type === 'highlight') {
                const elapsed = t - eff.startTime;
                const dur = eff.duration || 1500;
                if (elapsed < dur) {
                    const alpha = (1 - elapsed / dur) * 0.4;
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(dx, dy, NODE_R + 15, 0, Math.PI * 2);
                    ctx.fillStyle = (eff.color || '#fff') + Math.floor(alpha * 255).toString(16).padStart(2, '0');
                    ctx.fill();
                    ctx.restore();
                }
            }
        });

        // Port scan effect - numbers floating around
        ns.effects.forEach(eff => {
            if (eff.type === 'portscan') {
                const elapsed = t - eff.startTime;
                const dur = eff.duration || 4000;
                if (elapsed < dur) {
                    ctx.save();
                    ctx.font = 'bold 8px JetBrains Mono, monospace';
                    const portCount = 6;
                    for (let i = 0; i < portCount; i++) {
                        const angle = (i / portCount) * Math.PI * 2 + elapsed / 500;
                        const dist = NODE_R + 20 + Math.sin(elapsed / 300 + i) * 5;
                        const px = dx + Math.cos(angle) * dist;
                        const py = dy + Math.sin(angle) * dist;
                        const alpha = 0.4 + 0.3 * Math.sin(elapsed / 200 + i);
                        ctx.fillStyle = `rgba(59,130,246,${alpha})`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        const port = ns.ports ? ns.ports[i % ns.ports.length] : (22 + i * 100);
                        ctx.fillText(':' + port, px, py);
                    }
                    ctx.restore();
                }
            }
        });

        // Bruteforce effect - key attempts
        ns.effects.forEach(eff => {
            if (eff.type === 'bruteforce') {
                const elapsed = t - eff.startTime;
                const dur = eff.duration || 5000;
                if (elapsed < dur) {
                    ctx.save();
                    const keys = ['****', '####', 'PASS', 'AUTH', 'KEY!', 'DENY'];
                    const idx = Math.floor(elapsed / 200) % keys.length;
                    ctx.font = 'bold 9px JetBrains Mono, monospace';
                    ctx.fillStyle = `rgba(239,68,68,${0.5 + 0.3 * Math.sin(elapsed / 100)})`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(keys[idx], dx, dy - NODE_R - 10);
                    ctx.restore();
                }
            }
        });
    }

    function drawStatusBadges(dx, dy, ns) {
        const badges = [];
        if (ns.shield) badges.push({ icon: '🛡', color: '#10b981' });
        if (ns.firewall) badges.push({ icon: '🔥', color: '#f59e0b' });
        if (ns.monitor) badges.push({ icon: '📡', color: '#eab308' });
        if (ns.idsActive) badges.push({ icon: '🔍', color: '#3b82f6' });
        if (ns.state === 'under_attack') badges.push({ icon: '⚠', color: '#ef4444' });
        if (ns.state === 'compromised') badges.push({ icon: '☠', color: '#dc2626' });
        if (ns.rateLimit > 0) badges.push({ icon: '⏱', color: '#8b5cf6' });

        badges.forEach((b, i) => {
            const bx = dx + NODE_R - 5 + i * 14;
            const by = dy - NODE_R - 5;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.icon, bx, by);
        });
    }

    // ══════════════════════════════════════════════════════════
    //  PARTICLES & ATTACK PARTICLES
    // ══════════════════════════════════════════════════════════

    function spawnParticle(ev) {
        if (ev.event !== '+') return;
        const visualFrom = nodes.find(n => n.id === ev.from);
        const visualTo = nodes.find(n => n.id === ev.to);
        if (!visualFrom || !visualTo) return;
        const isAttack = ev.fid === '2';
        particles.push({
            x: visualFrom.x, y: visualFrom.y,
            targetX: visualTo.x, targetY: visualTo.y,
            color: isAttack ? '#ef4444' : '#10b981',
            progress: 0,
            speed: 0.02 + Math.random() * 0.02,
            size: isAttack ? 4 : 3,
        });
    }

    function spawnAttackParticle(fromNode, toNode) {
        if (!fromNode || !toNode) return;
        particles.push({
            x: fromNode.x + (Math.random() - 0.5) * 10,
            y: fromNode.y + (Math.random() - 0.5) * 10,
            targetX: toNode.x + (Math.random() - 0.5) * 10,
            targetY: toNode.y + (Math.random() - 0.5) * 10,
            color: '#ef4444',
            progress: 0,
            speed: 0.015 + Math.random() * 0.025,
            size: 3 + Math.random() * 3,
            glow: true,
        });
    }

    function spawnTrafficParticle(fromNode, toNode, color) {
        if (!fromNode || !toNode) return;
        particles.push({
            x: fromNode.x, y: fromNode.y,
            targetX: toNode.x, targetY: toNode.y,
            color: color || '#10b981',
            progress: 0,
            speed: 0.01 + Math.random() * 0.02,
            size: 2.5,
        });
    }

    function drawParticles() {
        if (particles.length === 0) return;
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.progress += p.speed;
            if (p.progress >= 1) {
                // Check if target node has shield - create block effect
                const targetNode = nodes.find(n =>
                    Math.abs(n.x - p.targetX) < 15 && Math.abs(n.y - p.targetY) < 15
                );
                if (targetNode && p.color === '#ef4444') {
                    const tns = getNodeState(targetNode.id);
                    if (tns.shield || tns.firewall) {
                        // Spawn block spark
                        for (let s = 0; s < 3; s++) {
                            particles.push({
                                x: p.targetX, y: p.targetY,
                                targetX: p.targetX + (Math.random() - 0.5) * 30,
                                targetY: p.targetY + (Math.random() - 0.5) * 30,
                                color: '#f59e0b',
                                progress: 0.5,
                                speed: 0.08,
                                size: 2,
                            });
                        }
                    }
                }
                particles.splice(i, 1);
                continue;
            }
            const curX = p.x + (p.targetX - p.x) * p.progress;
            const curY = p.y + (p.targetY - p.y) * p.progress;

            if (p.glow) {
                ctx.save();
                ctx.shadowBlur = 12;
                ctx.shadowColor = p.color;
            }
            ctx.beginPath();
            ctx.arc(curX, curY, p.size || 4, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            if (p.glow) {
                ctx.restore();
            }
        }
        // Limit particles
        if (particles.length > 500) {
            particles = particles.slice(-300);
        }
    }

    function animateLoop() {
        if (isAnimating) {
            draw();
            // Decay health for attacked nodes
            Object.keys(activeAttacks).forEach(aid => {
                const atk = activeAttacks[aid];
                const targetState = getNodeState(atk.to);
                if (targetState.shield || targetState.firewall) {
                    // Defense active - slow damage
                    targetState.health = Math.max(10, targetState.health - 0.02);
                } else {
                    targetState.health = Math.max(0, targetState.health - 0.08);
                    if (targetState.health <= 0 && targetState.state !== 'compromised') {
                        targetState.state = 'compromised';
                        logEvent('critical', `Node ${atk.to} has been COMPROMISED!`);
                    }
                }
            });
            requestAnimationFrame(animateLoop);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  DRAG & DROP FROM PALETTE
    // ══════════════════════════════════════════════════════════
    document.querySelectorAll('.device-item[draggable]').forEach(item => {
        item.addEventListener('dragstart', e => {
            e.dataTransfer.setData('node-type', item.dataset.type);
            e.dataTransfer.setData('node-label', item.dataset.label);
        });
    });

    canvas.addEventListener('dragover', e => e.preventDefault());
    canvas.addEventListener('drop', e => {
        e.preventDefault();
        const type = e.dataTransfer.getData('node-type');
        if (!type) return;
        const r = getRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const pos = screenToCanvas(sx, sy);
        addNode(type, pos.x, pos.y, e.dataTransfer.getData('node-label'));
    });

    function addNode(type, x, y, label) {
        nodeCounter++;
        const cfg = nodeConfig[type] || nodeConfig.router;
        const newNode = { id: 'n_' + nodeCounter, type, x, y, label: label || cfg.label + ' ' + nodeCounter };
        nodes.push(newNode);
        // Spawn visual effect
        addNodeEffect(newNode.id, { type: 'pulse', color: cfg.color, duration: 1500, count: 2 });
        addNodeEffect(newNode.id, { type: 'highlight', color: cfg.color, duration: 800 });
        if (helpShown) {
            helpShown = false;
            const helpEl = document.getElementById('canvasHelp');
            if (helpEl) helpEl.style.opacity = '0';
        }
        logEvent('info', `Added ${type} node: ${newNode.id}`);
        updateCounters();
        updateTopologyList();
        draw();
    }

    // ══════════════════════════════════════════════════════════
    //  MOUSE EVENTS
    // ══════════════════════════════════════════════════════════
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    function onMouseDown(e) {
        const pos = evPos(e);
        const hit = nodeAt(pos);
        if (tool === 'select') {
            if (hit) {
                dragNode = hit;
                isDragging = true;
                dragOffX = pos.x - hit.x;
                dragOffY = pos.y - hit.y;
                selectedNode = hit;
                showProperties(hit);
            } else {
                selectedNode = null;
                showProperties(null);
                isPanning = true;
                panStartX = e.clientX - panX;
                panStartY = e.clientY - panY;
            }
        } else if (tool === 'connect') {
            if (hit) {
                if (!connectingFrom) {
                    connectingFrom = hit.id;
                } else if (connectingFrom !== hit.id) {
                    const exists = links.find(l => (l.from===connectingFrom&&l.to===hit.id)||(l.from===hit.id&&l.to===connectingFrom));
                    if (!exists) {
                        const newLink = { id:'l_'+Date.now(), from:connectingFrom, to:hit.id };
                        links.push(newLink);
                        allocateInterfaces(newLink);
                        updateCounters();
                    }
                    connectingFrom = null;
                    connectingPreview = null;
                } else {
                    connectingFrom = null;
                    connectingPreview = null;
                }
            }
        } else if (tool === 'delete') {
            if (hit) {
                const linksToRemove = links.filter(l=>l.from===hit.id||l.to===hit.id);
                linksToRemove.forEach(freeInterfaces);
                nodes = nodes.filter(n=>n.id!==hit.id);
                links = links.filter(l=>l.from!==hit.id&&l.to!==hit.id);
                delete nodeStates[hit.id];
                if (selectedNode?.id===hit.id) { selectedNode=null; showProperties(null); }
                updateCounters();
                updateTopologyList();
            } else {
                const clickedLink = links.find(l => {
                    const a = nodes.find(n=>n.id===l.from);
                    const b = nodes.find(n=>n.id===l.to);
                    if (!a||!b) return false;
                    return distToSegment(pos, a, b) < 10;
                });
                if (clickedLink) {
                    freeInterfaces(clickedLink);
                    links = links.filter(l=>l.id!==clickedLink.id);
                    delete linkEffects[clickedLink.id];
                    updateCounters();
                }
            }
        }
        draw();
    }

    function distToSegment(p, a, b) {
        const dx=b.x-a.x, dy=b.y-a.y;
        const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
        return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
    }

    function onMouseMove(e) {
        const pos = evPos(e);
        if (isDragging && dragNode) {
            dragNode.x = pos.x - dragOffX;
            dragNode.y = pos.y - dragOffY;
            draw();
        } else if (isPanning) {
            panX = e.clientX - panStartX;
            panY = e.clientY - panStartY;
            draw();
        } else if (connectingFrom) {
            connectingPreview = pos;
            draw();
        }
        const hit = nodeAt(pos);
        if (tool==='delete') canvas.style.cursor = hit ? 'not-allowed' : 'default';
        else if (tool==='connect') canvas.style.cursor = hit ? 'crosshair' : 'default';
        else canvas.style.cursor = hit ? 'grab' : 'default';
    }

    function onMouseUp() {
        if (isDragging) { isDragging = false; dragNode = null; updateTopologyList(); }
        isPanning = false;
        saveToLocalStorage();
    }

    // Zoom
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        zoom = Math.max(0.3, Math.min(3, zoom * factor));
        draw();
    }, { passive:false });

    // ══════════════════════════════════════════════════════════
    //  TOOL BUTTONS
    // ══════════════════════════════════════════════════════════
    document.getElementById('toolSelect')?.addEventListener('click', () => setTool('select'));
    document.getElementById('toolConnect')?.addEventListener('click', () => setTool('connect'));
    document.getElementById('toolDelete')?.addEventListener('click', () => setTool('delete'));

    function setTool(t) {
        tool = t;
        connectingFrom = null;
        connectingPreview = null;
        ['toolSelect','toolConnect','toolDelete'].forEach(id => {
            document.getElementById(id)?.classList.remove('active');
        });
        const map = {select:'toolSelect',connect:'toolConnect',delete:'toolDelete'};
        document.getElementById(map[t])?.classList.add('active');
        draw();
    }

    // Zoom controls
    document.getElementById('zoomIn')?.addEventListener('click', () => { zoom=Math.min(3,zoom*1.2); draw(); });
    document.getElementById('zoomOut')?.addEventListener('click', () => { zoom=Math.max(0.3,zoom*0.8); draw(); });
    document.getElementById('resetView')?.addEventListener('click', () => { zoom=1; panX=0; panY=0; draw(); });

    // Clear
    document.getElementById('clearCanvas')?.addEventListener('click', () => {
        if (nodes.length===0) return;
        if (confirm('Clear all devices and connections?')) {
            nodes=[]; links=[]; selectedNode=null; nodeCounter=0;
            connectingFrom=null; helpShown=true;
            clearAllEffects();
            particles = [];
            const helpEl=document.getElementById('canvasHelp');
            if(helpEl) helpEl.style.opacity='1';
            updateCounters(); updateTopologyList(); showProperties(null); draw();
            saveToLocalStorage();
        }
    });

    // Load Template
    document.getElementById('loadTemplate')?.addEventListener('click', loadDefaultTemplate);
    function loadDefaultTemplate() {
        nodes=[]; links=[]; nodeCounter=0;
        clearAllEffects();
        particles = [];
        const W=canvas.width/zoom - panX/zoom;
        const H=canvas.height/zoom - panY/zoom;
        const cx=W*0.5, cy=H*0.5;
        const template = [
            { type:'client',   x:cx-260, y:cy-80,  label:'Client 1' },
            { type:'client',   x:cx-260, y:cy+80,  label:'Client 2' },
            { type:'attacker', x:cx-260, y:cy+220, label:'Attacker' },
            { type:'switch',   x:cx-80,  y:cy,     label:'Switch' },
            { type:'router',   x:cx+80,  y:cy,     label:'DTAF Router' },
            { type:'server',   x:cx+260, y:cy,     label:'Target Server' },
        ];
        template.forEach(t => {
            nodeCounter++;
            nodes.push({ id:'n_'+nodeCounter, ...t });
        });
        links = [
            { id:'l1', from:nodes[0].id, to:nodes[3].id },
            { id:'l2', from:nodes[1].id, to:nodes[3].id },
            { id:'l3', from:nodes[2].id, to:nodes[4].id },
            { id:'l4', from:nodes[3].id, to:nodes[4].id },
            { id:'l5', from:nodes[4].id, to:nodes[5].id },
        ];
        links.forEach(allocateInterfaces);
        helpShown=false;
        const helpEl=document.getElementById('canvasHelp');
        if(helpEl) helpEl.style.opacity='0';
        // Animate appearance
        nodes.forEach(n => {
            addNodeEffect(n.id, { type: 'pulse', color: nodeConfig[n.type]?.color || '#6366f1', duration: 1200, count: 2 });
        });
        updateCounters(); updateTopologyList(); draw();
        saveToLocalStorage();
    }

    // ══════════════════════════════════════════════════════════
    //  PROPERTIES PANEL
    // ══════════════════════════════════════════════════════════
    function showProperties(node) {
        const panel = document.getElementById('propContent');
        if (!panel) return;
        if (!node) {
            panel.innerHTML = `<div class="prop-empty"><i class="bi bi-cursor-text"></i><p>Click a device to see its properties</p></div>`;
            return;
        }
        const cfg = nodeConfig[node.type] || nodeConfig.router;
        const ns = getNodeState(node.id);
        const connectedLinks = links.filter(l=>l.from===node.id||l.to===node.id);
        const stateLabel = ns.state.replace(/_/g, ' ').toUpperCase();
        const stateColor = stateColors[ns.state]?.border || cfg.color;
        panel.innerHTML = `
            <div class="prop-section">
                <div class="prop-section-title">Device Info</div>
                <div class="prop-row">
                    <span class="prop-badge ${node.type}">${node.type.toUpperCase()}</span>
                    <span class="prop-state-badge" style="background:${stateColor}20;color:${stateColor};border:1px solid ${stateColor}40;font-size:0.65rem;padding:2px 6px;border-radius:4px;margin-left:6px;">${stateLabel}</span>
                </div>
                <div class="prop-row">
                    <label class="prop-label">Name</label>
                    <input class="prop-input" id="nodeLabel" value="${node.label}">
                </div>
                <div class="prop-row">
                    <label class="prop-label">Position</label>
                    <div style="font-size:0.72rem;color:var(--text-dim);font-family:'JetBrains Mono',monospace;">
                        X: ${Math.round(node.x)} &nbsp; Y: ${Math.round(node.y)}
                    </div>
                </div>
                <div class="prop-row">
                    <label class="prop-label">Health</label>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div style="flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
                            <div style="width:${ns.health}%;height:100%;background:${ns.health>60?'#10b981':ns.health>30?'#f59e0b':'#ef4444'};border-radius:3px;transition:width 0.3s;"></div>
                        </div>
                        <span style="font-size:0.7rem;color:var(--text-dim);font-family:'JetBrains Mono',monospace;">${Math.round(ns.health)}%</span>
                    </div>
                </div>
                <div class="prop-row">
                    <label class="prop-label">Connections</label>
                    <div style="font-size:0.72rem;color:var(--text-dim);">${connectedLinks.length} link(s)</div>
                </div>
                <div class="prop-row">
                    <label class="prop-label">Defenses</label>
                    <div style="font-size:0.72rem;color:var(--text-dim);">
                        ${ns.shield?'🛡 Shield ':''}${ns.firewall?'🔥 Firewall ':''}${ns.monitor?'📡 Monitor ':''}${ns.rateLimit>0?'⏱ RateLimit('+ns.rateLimit+') ':''}${(!ns.shield&&!ns.firewall&&!ns.monitor&&!ns.rateLimit)?'None':''}
                    </div>
                </div>
                <button class="delete-node-btn" id="deleteNodeBtn">
                    <i class="bi bi-trash3-fill"></i> Delete Device
                </button>
            </div>
        `;
        document.getElementById('nodeLabel')?.addEventListener('input', e => {
            node.label = e.target.value;
            draw(); updateTopologyList();
        });
        document.getElementById('deleteNodeBtn')?.addEventListener('click', () => {
            nodes = nodes.filter(n=>n.id!==node.id);
            links = links.filter(l=>l.from!==node.id&&l.to!==node.id);
            delete nodeStates[node.id];
            selectedNode=null; showProperties(null);
            updateCounters(); updateTopologyList(); draw(); saveToLocalStorage();
        });
    }

    // ══════════════════════════════════════════════════════════
    //  TOPOLOGY LIST
    // ══════════════════════════════════════════════════════════
    function updateTopologyList() {
        const list = document.getElementById('topologyList');
        if (!list) return;
        if (nodes.length===0) {
            list.innerHTML=`<div class="prop-empty"><i class="bi bi-diagram-3"></i><p>No devices yet</p></div>`;
            return;
        }
        list.innerHTML = nodes.map(n => {
            const cfg = nodeConfig[n.type]||nodeConfig.router;
            const ns = getNodeState(n.id);
            const stateIcon = ns.state === 'under_attack' ? '⚠' : ns.state === 'protected' || ns.state === 'defending' ? '🛡' : ns.state === 'compromised' ? '☠' : ns.state === 'quarantined' ? '🔒' : '';
            return `<div class="topology-item" data-id="${n.id}">
                <span style="color:${cfg.color};font-size:1rem;">${cfg.icon}</span>
                <span style="font-size:0.75rem;color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n.label}</span>
                <span style="font-size:0.65rem;">${stateIcon}</span>
                <span style="font-size:0.6rem;color:var(--text-dim);">${n.id}</span>
            </div>`;
        }).join('');
        list.querySelectorAll('.topology-item').forEach(item => {
            item.addEventListener('click', () => {
                const node = nodes.find(n=>n.id===item.dataset.id);
                if (node) { selectedNode=node; showProperties(node); draw(); }
            });
        });
    }

    function updateCounters() {
        const nc = document.getElementById('nodeCounter');
        const lc = document.getElementById('linkCounter');
        if (nc) nc.textContent = nodes.length;
        if (lc) lc.textContent = links.length;
    }

    // ══════════════════════════════════════════════════════════
    //  SAVE / LOAD
    // ══════════════════════════════════════════════════════════
    function saveToLocalStorage() {
        const name = document.getElementById('workspaceName')?.value || 'My Topology';
        const data = { name, nodes: nodes.map(n=>({...n})), links: links.map(l=>({...l})) };
        localStorage.setItem('dtaf_workspace', JSON.stringify(data));
    }

    function loadFromLocalStorage() {
        const raw = localStorage.getItem('dtaf_workspace');
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            nodes = data.nodes || [];
            links = data.links || [];
            if (nodes.length) {
                const maxId = Math.max(...nodes.map(n => parseInt(n.id.replace('n_','')) || 0));
                nodeCounter = isNaN(maxId) ? 0 : maxId;
                helpShown = false;
                const helpEl = document.getElementById('canvasHelp');
                if (helpEl) helpEl.style.opacity = '0';
                const nameEl = document.getElementById('workspaceName');
                if (nameEl && data.name) nameEl.value = data.name;
            }
            updateCounters(); updateTopologyList(); showProperties(null); draw();
        } catch(e){}
    }

    // API Save/Load
    document.getElementById('saveWorkspace')?.addEventListener('click', () => {
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('saveModal'));
        const name = document.getElementById('workspaceName')?.value || 'My Topology';
        document.getElementById('saveWsName').value = name;
        modal.show();
    });

    document.getElementById('confirmSave')?.addEventListener('click', async () => {
        const name = document.getElementById('saveWsName')?.value || 'My Topology';
        if (document.getElementById('workspaceName')) document.getElementById('workspaceName').value = name;
        saveToLocalStorage();
        try {
            await fetch('/api/workspace/save', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ id:'ws_'+Date.now(), name, topology:{nodes,links} })
            });
        } catch(e){}
        bootstrap.Modal.getInstance(document.getElementById('saveModal'))?.hide();
        showToast('Workspace saved!');
    });

    document.getElementById('loadWorkspace')?.addEventListener('click', async () => {
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('loadModal'));
        const listEl = document.getElementById('workspaceList');
        listEl.innerHTML = '<div class="text-center text-muted p-3"><div class="spinner-border spinner-border-sm"></div></div>';
        modal.show();
        try {
            const res = await fetch('/api/workspace/load');
            const data = await res.json();
            const wsList = data.workspaces || [];
            if (!wsList.length) {
                listEl.innerHTML = '<div class="text-center text-muted p-3 small">No saved workspaces</div>';
                return;
            }
            listEl.innerHTML = wsList.map(ws=>`
                <div class="workspace-list-item" data-id="${ws.id}">
                    <div>
                        <div style="font-size:0.85rem;font-weight:600;color:var(--text);">${ws.name}</div>
                        <div style="font-size:0.72rem;color:var(--text-dim);">${ws.node_count} devices</div>
                    </div>
                    <i class="bi bi-arrow-right text-muted"></i>
                </div>`).join('');
            listEl.querySelectorAll('.workspace-list-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const res2 = await fetch('/api/workspace/'+item.dataset.id);
                    const ws = await res2.json();
                    if (ws.topology) {
                        nodes = ws.topology.nodes || [];
                        links = ws.topology.links || [];
                        if (nodes.length) {
                            const maxId = Math.max(...nodes.map(n => parseInt(n.id.replace('n_','')) || 0));
                            nodeCounter = isNaN(maxId) ? 0 : maxId;
                        }
                        helpShown=false;
                        const helpEl=document.getElementById('canvasHelp');
                        if(helpEl) helpEl.style.opacity='0';
                        clearAllEffects();
                        updateCounters(); updateTopologyList(); showProperties(null); draw(); saveToLocalStorage();
                    }
                    bootstrap.Modal.getOrCreateInstance(document.getElementById('loadModal'))?.hide();
                    showToast('Workspace loaded!');
                });
            });
        } catch(e) { listEl.innerHTML='<div class="text-center text-muted p-3 small">Error loading workspaces</div>'; }
    });

    function showToast(msg, type = 'success') {
        const colors = {
            success: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)', text: '#10b981', icon: 'check-circle-fill' },
            error: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)', text: '#ef4444', icon: 'exclamation-triangle-fill' },
            warning: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b', icon: 'exclamation-circle-fill' },
            info: { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.3)', text: '#3b82f6', icon: 'info-circle-fill' },
        };
        const c = colors[type] || colors.success;
        const t = document.createElement('div');
        t.style.cssText = `position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;background:${c.bg};border:1px solid ${c.border};color:${c.text};padding:0.6rem 1.2rem;border-radius:10px;font-size:0.82rem;font-weight:600;backdrop-filter:blur(12px);animation:fadeIn 0.3s ease;`;
        t.innerHTML = `<i class="bi bi-${c.icon} me-2"></i>${msg}`;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    // Init
    loadFromLocalStorage();
    document.getElementById('workspaceName')?.addEventListener('input', saveToLocalStorage);

    // ══════════════════════════════════════════════════════════
    //  DYNAMIC SIMULATION INTEGRATION
    // ══════════════════════════════════════════════════════════
    const goSimulateBtn = document.getElementById('goSimulate');
    const simulateModalEl = document.getElementById('simulateModal');
    const runDynamicSimBtn = document.getElementById('runDynamicSimBtn');

    if (goSimulateBtn && simulateModalEl && runDynamicSimBtn) {
        goSimulateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const simModal = bootstrap.Modal.getOrCreateInstance(simulateModalEl);
            if (nodes.length === 0) { showToast("Please add devices first!", 'warning'); return; }
            if (!nodes.some(n => n.type === 'server')) { showToast("Need at least one Server!", 'warning'); return; }
            document.getElementById('simLoading').classList.add('d-none');
            document.getElementById('simResults').classList.add('d-none');
            runDynamicSimBtn.disabled = false;
            simModal.show();
        });

        runDynamicSimBtn.addEventListener('click', async () => {
            const defenseMode = document.getElementById('simDefenseMode').value;
            const attackPps = document.getElementById('simAttackPps').value;
            document.getElementById('simLoading').classList.remove('d-none');
            document.getElementById('simResults').classList.add('d-none');
            document.getElementById('simPlaybackPanel').classList.add('d-none');
            document.getElementById('simLoadingText').innerText = "NS2 Engine running dynamic TCL script...";
            runDynamicSimBtn.disabled = true;

            try {
                const res = await fetch('/api/simulate_workspace', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        defense_mode: defenseMode,
                        attack_pps: parseInt(attackPps),
                        topology: { nodes, links }
                    })
                });
                const data = await res.json();
                if (data.error) {
                    showToast("Simulation Error: " + data.error, 'error');
                    document.getElementById('simLoading').classList.add('d-none');
                    runDynamicSimBtn.disabled = false;
                    return;
                }
                document.getElementById('simLoading').classList.add('d-none');
                document.getElementById('simResults').classList.remove('d-none');
                document.getElementById('simPlaybackPanel').classList.remove('d-none');
                runDynamicSimBtn.disabled = false;
                document.getElementById('resThroughput').innerText = data.summary.avg_throughput + ' Kbps';
                document.getElementById('resLoss').innerText = data.summary.avg_loss + '%';
                document.getElementById('resDelay').innerText = data.summary.avg_delay + ' ms';
                showToast("Simulation Complete!");
                if (data.events && data.events.length > 0) runPlayback(data.events);
                localStorage.setItem('dtaf_sim_results', JSON.stringify(data));
            } catch (err) {
                showToast("Failed to run simulation", 'error');
                document.getElementById('simLoading').classList.add('d-none');
                runDynamicSimBtn.disabled = false;
            }
        });
    }

    // ══════════════════════════════════════════════════════════
    //  PLAYBACK ENGINE
    // ══════════════════════════════════════════════════════════
    function runPlayback(events) {
        if (simPlaybackInterval) clearInterval(simPlaybackInterval);
        simulationEvents = events || [];
        currentPlaybackTime = 0;
        particles = [];

        const progressEl = document.getElementById('playbackProgress');
        const consoleEl = document.getElementById('liveConsole');
        if (consoleEl) consoleEl.innerHTML = '> Simulation started...<br>';

        simulationEvents.sort((a,b) => a.time - b.time);
        const maxTime = 60.0;
        let eventIndex = 0;

        // Update network state for simulation
        nodes.forEach(n => {
            if (n.type === 'attacker') {
                const ns = getNodeState(n.id);
                ns.state = 'under_attack';
                addNodeEffect(n.id, { type: 'pulse', color: '#ef4444', duration: 60000, count: 3 });
            }
            if (n.type === 'server') {
                addNodeEffect(n.id, { type: 'pulse', color: '#10b981', duration: 60000, count: 2 });
            }
        });

        simPlaybackInterval = setInterval(() => {
            currentPlaybackTime += 0.5;
            if (progressEl) progressEl.style.width = Math.min(100, (currentPlaybackTime / maxTime) * 100) + '%';
            let processedAny = false;
            while(eventIndex < simulationEvents.length && simulationEvents[eventIndex].time <= currentPlaybackTime) {
                const ev = simulationEvents[eventIndex];
                if (ev.event === 'd' && consoleEl && Math.random() < 0.2) {
                    const type = ev.fid === '2' ? 'ATTACK' : 'LEGIT';
                    const color = ev.fid === '2' ? '#ef4444' : '#f59e0b';
                    consoleEl.innerHTML += `<span style="color:${color}"> [${ev.time.toFixed(2)}s] DROP: ${type} packet at ${ev.from}</span><br>`;
                    processedAny = true;
                } else if (ev.event === 'r' && consoleEl && Math.random() < 0.1 && ev.fid === '1') {
                    consoleEl.innerHTML += `<span style="color:#10b981"> [${ev.time.toFixed(2)}s] RCV: Legit packet reached server.</span><br>`;
                    processedAny = true;
                }
                spawnParticle(ev);
                eventIndex++;
            }
            if (processedAny && consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
            if (currentPlaybackTime >= maxTime) {
                clearInterval(simPlaybackInterval);
                if (consoleEl) {
                    consoleEl.innerHTML += `<span style="color:#6366f1">> Simulation playback finished.</span><br>`;
                    consoleEl.scrollTop = consoleEl.scrollHeight;
                }
                // Reset states
                nodes.forEach(n => {
                    const ns = getNodeState(n.id);
                    ns.state = 'normal';
                    ns.effects = [];
                });
            }
        }, 100);

        ensureAnimating();
    }

    // ══════════════════════════════════════════════════════════
    //  TERMINAL CONTROLLER — FULL COMMAND ENGINE v2.0
    // ══════════════════════════════════════════════════════════
    const terminalOverlay = document.getElementById('terminalOverlay');
    const toolTerminalBtn = document.getElementById('toolTerminal');
    const closeTerminalBtn = document.getElementById('closeTerminalBtn');
    const terminalInput = document.getElementById('terminalInput');
    const terminalOutput = document.getElementById('terminalOutput');
    let commandHistory = [];
    let historyIndex = -1;

    if (toolTerminalBtn && terminalOverlay) {
        toolTerminalBtn.addEventListener('click', () => {
            terminalOverlay.classList.remove('d-none');
            terminalInput.focus();
        });

        closeTerminalBtn.addEventListener('click', () => {
            terminalOverlay.classList.add('d-none');
        });

        function printLine(text, type = 'info') {
            const colors = {
                info: '#e2e8f0',
                success: '#10b981',
                error: '#ef4444',
                warning: '#f59e0b',
                system: '#6366f1',
                attack: '#ef4444',
                defense: '#10b981',
                scan: '#3b82f6',
                header: '#a855f7',
                dim: '#64748b',
                cyan: '#22d3ee',
            };
            const line = document.createElement('div');
            line.className = 'terminal-line';
            line.innerHTML = `<span style="color:${colors[type] || colors.info}">${text}</span>`;
            terminalOutput.appendChild(line);
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }

        function printSeparator() {
            printLine('─'.repeat(55), 'dim');
        }

        // Command history navigation
        terminalInput.addEventListener('keydown', async (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    terminalInput.value = commandHistory[commandHistory.length - 1 - historyIndex];
                }
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    terminalInput.value = commandHistory[commandHistory.length - 1 - historyIndex];
                } else {
                    historyIndex = -1;
                    terminalInput.value = '';
                }
                return;
            }

            if (e.key !== 'Enter') return;
            const cmdString = terminalInput.value.trim();
            if (!cmdString) return;

            // Store in history
            commandHistory.push(cmdString);
            historyIndex = -1;

            // Echo command
            const echo = document.createElement('div');
            echo.className = 'terminal-line';
            echo.innerHTML = `<span class="terminal-prompt" style="color:#6366f1">root@dtaf:~#</span> <span style="color:#e2e8f0">${escapeHtml(cmdString)}</span>`;
            terminalOutput.appendChild(echo);
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
            terminalInput.value = '';

            // Parse command
            const args = cmdString.split(/\s+/);
            const cmd = args[0].toLowerCase();

            try {
                await executeCommand(cmd, args.slice(1), cmdString);
            } catch (err) {
                printLine(`Error: ${err.message}`, 'error');
            }
        });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // ══════════════════════════════════════════════════════
        //  COMMAND EXECUTOR
        // ══════════════════════════════════════════════════════
        async function executeTerminalAttackSimulation(attackType, targetId, pps, duration=60) {
            printLine(`> Launching ${attackType.toUpperCase()} simulation on ${targetId}...`, 'info');
            try {
                // Determine defense mode
                let defenseMode = 'none';
                if (globalDTAF) defenseMode = 'dtaf';
                else if (globalIDS || nodes.some(n => getNodeState(n.id).shield || getNodeState(n.id).firewall)) defenseMode = 'static';

                const res = await fetch('/api/attack', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        attack_type: attackType,
                        defense_mode: defenseMode,
                        attack_pps: pps,
                        duration: duration,
                        topology: { nodes, links }
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                
                printLine(`  [Sim Results] Throughput: ${data.summary.avg_throughput} Kbps | Loss: ${data.summary.avg_loss}% | Delay: ${data.summary.avg_delay} ms`, data.summary.avg_loss > 20 ? 'error' : 'success');
                if (data.summary.total_attack_blocked > 0) {
                    printLine(`  [Sim Defense] ${data.summary.total_attack_blocked} malicious packets blocked!`, 'defense');
                }
                
                // Update node health based on simulation results
                const targetState = getNodeState(targetId);
                if (data.summary.avg_loss > 50) {
                    targetState.health = Math.max(0, targetState.health - 40);
                    if (targetState.health <= 0) targetState.state = 'compromised';
                } else if (data.summary.avg_loss > 10) {
                    targetState.health = Math.max(10, targetState.health - 15);
                }
                
                return data;
            } catch (err) {
                printLine(`  [Sim Error] ${err.message}`, 'error');
                return null;
            }
        }

        async function executeCommand(cmd, args, fullCmd) {
            switch (cmd) {

            // ─────────────── HELP ───────────────
            case 'help':
                printLine('');
                printLine('╔══════════════════════════════════════════════════════════════╗', 'header');
                printLine('║            DTAF Shield Terminal v2.0 — Command Reference     ║', 'header');
                printLine('╚══════════════════════════════════════════════════════════════╝', 'header');
                printLine('');
                printLine(' 🔍 SCANNING & RECONNAISSANCE', 'scan');
                printLine('   ping <id>              Ping a node — blue pulse effect', 'info');
                printLine('   scan [id]              Scan a node or entire network', 'info');
                printLine('   nmap [id]              Full port scan with service detection', 'info');
                printLine('   portscan <id>          Scan open ports on target', 'info');
                printLine('   traceroute <id1> <id2> Trace route between two nodes', 'info');
                printLine('   whois <id>             Show detailed node info', 'info');
                printLine('');
                printLine(' ⚔️  ATTACK TOOLS', 'attack');
                printLine('   dos <target> [pps]     DoS flood attack on target', 'info');
                printLine('   ddos [pps]             DDoS from ALL attacker nodes', 'info');
                printLine('   synflood <target>      SYN flood attack', 'info');
                printLine('   udpflood <target>      UDP flood attack', 'info');
                printLine('   icmpflood <target>     ICMP flood (Ping of Death)', 'info');
                printLine('   httpflood <target>     HTTP GET flood attack', 'info');
                printLine('   slowloris <target>     Slow HTTP connection exhaustion', 'info');
                printLine('   amplification <id>     DNS/NTP Amplification attack', 'info');
                printLine('   mitm <id1> <id2>       Man-in-the-Middle intercept', 'info');
                printLine('   dns_spoof [id]         DNS spoofing attack', 'info');
                printLine('   bruteforce <target>    Brute force authentication', 'info');
                printLine('   deauth <id>            Deauthentication attack', 'info');
                printLine('   stop_attack [id]       Stop attack on target', 'info');
                printLine('');
                printLine(' 🛡️  DEFENSE TOOLS', 'defense');
                printLine('   shield <id>            Activate shield protection', 'info');
                printLine('   firewall <id>          Toggle firewall on node', 'info');
                printLine('   ids [on|off]           Intrusion Detection System', 'info');
                printLine('   block <id>             Block malicious node', 'info');
                printLine('   unblock <id>           Unblock a blocked node', 'info');
                printLine('   rate_limit <id> <rate>  Rate limit a node', 'info');
                printLine('   dtaf [on|off]          Toggle DTAF adaptive defense', 'info');
                printLine('   quarantine <id>        Isolate compromised node', 'info');
                printLine('   patch <id>             Repair compromised node', 'info');
                printLine('   honeypot <id>          Deploy honeypot on node', 'info');
                printLine('');
                printLine(' 📊 MONITORING', 'cyan');
                printLine('   monitor [on|off]       Toggle global monitoring', 'info');
                printLine('   status [id]            Show node or network status', 'info');
                printLine('   traffic                Real-time traffic analysis', 'info');
                printLine('   stats                  Network statistics', 'info');
                printLine('   log [n]                Show event log', 'info');
                printLine('   alerts                 Show active alerts', 'info');
                printLine('');
                printLine(' ⚙️  NETWORK CONFIG', 'system');
                printLine('   add <type>             Add device node', 'info');
                printLine('   link <a> <b>           Connect two nodes', 'info');
                printLine('   unlink <a> <b>         Disconnect two nodes', 'info');
                printLine('   delete <id>            Delete a node', 'info');
                printLine('   rename <id> <name>     Rename a node', 'info');
                printLine('   isolate <id>           Disconnect all links', 'info');
                printLine('   restore <id>           Restore node to normal', 'info');
                printLine('');
                printLine(' 🔧 SIMULATION & UTILITY', 'system');
                printLine('   simulate [mode]        Run NS2 simulation (none|static|dtaf)', 'info');
                printLine('   attack [pps] [mode]    Attack simulation with NS2', 'info');
                printLine('   list [nodes|links]     List network elements', 'info');
                printLine('   reset                  Reset all states & effects', 'info');
                printLine('   clear                  Clear terminal output', 'info');
                printLine('   topology               Show topology summary', 'info');
                printLine('');
                break;

            // ─────────────── CLEAR ───────────────
            case 'clear':
                if (args[0] === 'canvas') {
                    document.getElementById('clearCanvas')?.click();
                    printLine('Canvas cleared.', 'success');
                } else {
                    terminalOutput.innerHTML = '';
                }
                break;

            // ─────────────── ADD ───────────────
            case 'add': {
                const type = args[0];
                if (!type) { printLine('Usage: add <router|switch|server|client|attacker|firewall>', 'warning'); break; }
                if (nodeConfig[type]) {
                    const rx = (canvas.width / 2) / zoom - panX / zoom + (Math.random() * 100 - 50);
                    const ry = (canvas.height / 2) / zoom - panY / zoom + (Math.random() * 100 - 50);
                    addNode(type, rx, ry);
                    printLine(`✓ Added ${type} node [${nodes[nodes.length-1].id}]`, 'success');
                    logEvent('info', `Added ${type} via terminal`);
                } else {
                    printLine(`Unknown device type '${type}'. Available: router, switch, server, client, attacker, firewall`, 'error');
                }
                break;
            }

            // ─────────────── LINK ───────────────
            case 'link': {
                const fromId = args[0];
                const toId = args[1];
                if (!fromId || !toId) { printLine('Usage: link <nodeId1> <nodeId2>', 'warning'); break; }
                const fromNode = nodes.find(n => n.id === fromId);
                const toNode = nodes.find(n => n.id === toId);
                if (!fromNode) { printLine(`Node ${fromId} not found.`, 'error'); break; }
                if (!toNode) { printLine(`Node ${toId} not found.`, 'error'); break; }
                const exists = links.find(l => (l.from===fromId&&l.to===toId)||(l.from===toId&&l.to===fromId));
                if (exists) { printLine(`Link already exists between ${fromId} and ${toId}.`, 'warning'); break; }
                const newLink = { id:'l_'+Date.now(), from:fromId, to:toId };
                links.push(newLink);
                addLinkEffect(newLink.id, { type: 'highlight', color: '#10b981', duration: 2000 });
                updateCounters(); draw();
                printLine(`✓ Linked ${fromId} ↔ ${toId}`, 'success');
                logEvent('info', `Linked ${fromId} ↔ ${toId}`);
                break;
            }

            // ─────────────── UNLINK ───────────────
            case 'unlink': {
                const a = args[0], b = args[1];
                if (!a || !b) { printLine('Usage: unlink <nodeId1> <nodeId2>', 'warning'); break; }
                const lnk = findLinkBetween(a, b);
                if (!lnk) { printLine(`No link found between ${a} and ${b}.`, 'error'); break; }
                links = links.filter(l => l.id !== lnk.id);
                delete linkEffects[lnk.id];
                updateCounters(); draw();
                printLine(`✓ Removed link between ${a} ↔ ${b}`, 'success');
                logEvent('info', `Unlinked ${a} ↔ ${b}`);
                break;
            }

            // ─────────────── DELETE ───────────────
            case 'delete': {
                const delId = args[0];
                if (!delId) { printLine('Usage: delete <nodeId>', 'warning'); break; }
                const delNode = nodes.find(n => n.id === delId);
                if (!delNode) { printLine(`Node ${delId} not found.`, 'error'); break; }
                // Flash effect before removal
                addNodeEffect(delId, { type: 'pulse', color: '#ef4444', duration: 500, count: 3 });
                setTimeout(() => {
                    nodes = nodes.filter(n => n.id !== delId);
                    links = links.filter(l => l.from !== delId && l.to !== delId);
                    delete nodeStates[delId];
                    if (selectedNode?.id === delId) { selectedNode = null; showProperties(null); }
                    updateCounters(); updateTopologyList(); draw(); saveToLocalStorage();
                }, 300);
                printLine(`✓ Deleted node ${delId} (${delNode.label})`, 'success');
                logEvent('info', `Deleted node ${delId}`);
                break;
            }

            // ─────────────── RENAME ───────────────
            case 'rename': {
                const rnId = args[0];
                const newName = args.slice(1).join(' ');
                if (!rnId || !newName) { printLine('Usage: rename <nodeId> <newName>', 'warning'); break; }
                const rnNode = nodes.find(n => n.id === rnId);
                if (!rnNode) { printLine(`Node ${rnId} not found.`, 'error'); break; }
                const oldName = rnNode.label;
                rnNode.label = newName;
                addNodeEffect(rnId, { type: 'highlight', color: '#a855f7', duration: 1000 });
                updateTopologyList(); draw();
                printLine(`✓ Renamed ${rnId}: "${oldName}" → "${newName}"`, 'success');
                break;
            }

            // ─────────────── PING ───────────────
            case 'ping': {
                const pingId = args[0];
                if (!pingId) { printLine('Usage: ping <nodeId>', 'warning'); break; }
                const pingNode = nodes.find(n => n.id === pingId);
                if (!pingNode) { printLine(`Node ${pingId} not found.`, 'error'); break; }
                printLine(`PING ${pingId} (${pingNode.label})...`, 'scan');
                addNodeEffect(pingId, { type: 'pulse', color: '#3b82f6', duration: 3000, count: 4 });
                addNodeEffect(pingId, { type: 'highlight', color: '#3b82f6', duration: 1500 });
                ensureAnimating();

                const connLinks = links.filter(l => l.from === pingId || l.to === pingId);
                connLinks.forEach(l => {
                    addLinkEffect(l.id, { type: 'traffic_flow', color: '#3b82f6', duration: 3000 });
                });

                // Simulate ping responses
                const delays = [12, 15, 11, 14, 13];
                for (let i = 0; i < delays.length; i++) {
                    setTimeout(() => {
                        const jitter = Math.random() * 5;
                        printLine(`  64 bytes from ${pingId}: seq=${i+1} ttl=64 time=${(delays[i] + jitter).toFixed(1)} ms`, 'info');
                        if (i === delays.length - 1) {
                            printLine(`  --- ${pingId} ping statistics ---`, 'scan');
                            printLine(`  ${delays.length} packets transmitted, ${delays.length} received, 0% packet loss`, 'success');
                            logEvent('scan', `Ping ${pingId}: OK`);
                        }
                    }, (i + 1) * 400);
                }
                break;
            }

            // ─────────────── SCAN ───────────────
            case 'scan': {
                const scanId = args[0];
                if (scanId) {
                    const scanNode = nodes.find(n => n.id === scanId);
                    if (!scanNode) { printLine(`Node ${scanId} not found.`, 'error'); break; }
                    printLine(`Scanning ${scanId} (${scanNode.label})...`, 'scan');
                    const ns = getNodeState(scanId);
                    ns.state = 'scanning';
                    addNodeEffect(scanId, { type: 'scan', duration: 4000 });
                    addNodeEffect(scanId, { type: 'pulse', color: '#3b82f6', duration: 4000, count: 3 });

                    setTimeout(() => {
                        printLine(`  [SCAN RESULT] ${scanId}`, 'scan');
                        printLine(`    Type: ${scanNode.type.toUpperCase()}`, 'info');
                        printLine(`    OS: ${ns.os}`, 'info');
                        printLine(`    Open Ports: ${ns.ports.join(', ')}`, 'info');
                        printLine(`    Services: ${ns.services.join(', ')}`, 'info');
                        printLine(`    State: ${ns.state.toUpperCase()}`, 'info');
                        printLine(`    Health: ${Math.round(ns.health)}%`, ns.health > 60 ? 'success' : 'warning');
                        printLine(`    Defenses: ${ns.shield?'Shield ':''} ${ns.firewall?'Firewall ':''}${(!ns.shield&&!ns.firewall)?'None':''}`, 'info');
                        ns.state = 'normal';
                        logEvent('scan', `Scanned ${scanId}`);
                        draw();
                    }, 3500);
                } else {
                    // Scan entire network
                    printLine(`Starting full network scan... (${nodes.length} nodes)`, 'scan');
                    nodes.forEach((n, i) => {
                        const ns = getNodeState(n.id);
                        setTimeout(() => {
                            ns.state = 'scanning';
                            addNodeEffect(n.id, { type: 'scan', duration: 2000 });
                            addNodeEffect(n.id, { type: 'pulse', color: '#3b82f6', duration: 2000, count: 2 });
                            printLine(`  [${i+1}/${nodes.length}] Scanning ${n.id} (${n.label})... ✓`, 'scan');
                            setTimeout(() => {
                                ns.state = 'normal';
                                draw();
                            }, 2000);
                            if (i === nodes.length - 1) {
                                setTimeout(() => {
                                    printLine(`  Network scan complete: ${nodes.length} hosts up`, 'success');
                                    logEvent('scan', 'Full network scan completed');
                                }, 1000);
                            }
                        }, i * 600);
                    });
                }
                ensureAnimating();
                break;
            }

            // ─────────────── NMAP ───────────────
            case 'nmap': {
                const nmapId = args[0];
                const targets = nmapId ? [nodes.find(n => n.id === nmapId)].filter(Boolean) : nodes;
                if (nmapId && targets.length === 0) { printLine(`Node ${nmapId} not found.`, 'error'); break; }
                printLine(`Starting Nmap 7.94 ( https://nmap.org )`, 'scan');
                printLine(`Nmap scan report for ${targets.length} host(s)`, 'info');
                printSeparator();
                targets.forEach((n, i) => {
                    const ns = getNodeState(n.id);
                    addNodeEffect(n.id, { type: 'portscan', duration: 5000 });
                    addNodeEffect(n.id, { type: 'scan', duration: 5000 });
                    setTimeout(() => {
                        printLine(`  Host: ${n.id} (${n.label})`, 'scan');
                        printLine(`  State: up`, 'success');
                        printLine(`  OS: ${ns.os}`, 'info');
                        printLine(`  PORT      STATE    SERVICE`, 'dim');
                        ns.ports.forEach(p => {
                            const svc = {22:'ssh',80:'http',443:'https',3306:'mysql',53:'dns',25:'smtp',21:'ftp',23:'telnet',8080:'http-proxy',3389:'ms-wbt-server'}[p] || 'unknown';
                            printLine(`  ${String(p).padEnd(5)}/tcp  open     ${svc}`, 'info');
                        });
                        printLine('', 'info');
                        ns.state = 'normal';
                    }, i * 800 + 500);
                });
                setTimeout(() => {
                    printLine(`Nmap done: ${targets.length} IP addresses scanned`, 'success');
                    logEvent('scan', `Nmap scan: ${targets.length} hosts`);
                }, targets.length * 800 + 1000);
                ensureAnimating();
                break;
            }

            // ─────────────── PORTSCAN ───────────────
            case 'portscan': {
                const psId = args[0];
                if (!psId) { printLine('Usage: portscan <nodeId>', 'warning'); break; }
                const psNode = nodes.find(n => n.id === psId);
                if (!psNode) { printLine(`Node ${psId} not found.`, 'error'); break; }
                const ns = getNodeState(psId);
                printLine(`Port scanning ${psId} (${psNode.label})...`, 'scan');
                addNodeEffect(psId, { type: 'portscan', duration: 5000 });
                addNodeEffect(psId, { type: 'pulse', color: '#3b82f6', duration: 5000, count: 3 });
                ensureAnimating();
                setTimeout(() => {
                    printLine(`  Discovered ${ns.ports.length} open ports:`, 'success');
                    ns.ports.forEach(p => {
                        const svc = {22:'SSH',80:'HTTP',443:'HTTPS',3306:'MySQL',53:'DNS',25:'SMTP'}[p] || 'Unknown';
                        printLine(`    Port ${p}/tcp — ${svc} — OPEN`, 'info');
                    });
                    logEvent('scan', `Port scan on ${psId}: ${ns.ports.length} ports open`);
                }, 4000);
                break;
            }

            // ─────────────── TRACEROUTE ───────────────
            case 'traceroute': {
                const trFrom = args[0], trTo = args[1];
                if (!trFrom || !trTo) { printLine('Usage: traceroute <fromId> <toId>', 'warning'); break; }
                if (!nodes.find(n => n.id === trFrom)) { printLine(`Node ${trFrom} not found.`, 'error'); break; }
                if (!nodes.find(n => n.id === trTo)) { printLine(`Node ${trTo} not found.`, 'error'); break; }
                const path = findPath(trFrom, trTo);
                if (!path) { printLine(`No route found from ${trFrom} to ${trTo}.`, 'error'); break; }
                printLine(`traceroute to ${trTo}, ${path.length} hops`, 'scan');
                // Highlight the path
                for (let i = 0; i < path.length - 1; i++) {
                    const lnk = findLinkBetween(path[i], path[i+1]);
                    if (lnk) addLinkEffect(lnk.id, { type: 'highlight', color: '#22d3ee', duration: 5000 });
                }
                path.forEach((nodeId, i) => {
                    addNodeEffect(nodeId, { type: 'pulse', color: '#22d3ee', duration: 3000, count: 2 });
                    setTimeout(() => {
                        const delay = (5 + Math.random() * 15).toFixed(1);
                        const n = nodes.find(nd => nd.id === nodeId);
                        printLine(`  ${i+1}  ${nodeId} (${n?.label || '???'})  ${delay} ms`, 'info');
                        if (i === path.length - 1) {
                            printLine(`  Route: ${path.join(' → ')}`, 'success');
                            logEvent('scan', `Traceroute ${trFrom} → ${trTo}: ${path.length} hops`);
                        }
                    }, i * 500);
                });
                ensureAnimating();
                break;
            }

            // ─────────────── WHOIS ───────────────
            case 'whois': {
                const wId = args[0];
                if (!wId) { printLine('Usage: whois <nodeId>', 'warning'); break; }
                const wNode = nodes.find(n => n.id === wId);
                if (!wNode) { printLine(`Node ${wId} not found.`, 'error'); break; }
                const wns = getNodeState(wId);
                const connLinks = links.filter(l => l.from === wId || l.to === wId);
                const connNodes = connLinks.map(l => l.from === wId ? l.to : l.from);
                addNodeEffect(wId, { type: 'highlight', color: '#a855f7', duration: 2000 });
                printSeparator();
                printLine(`  WHOIS Information for ${wId}`, 'header');
                printSeparator();
                printLine(`  Label:       ${wNode.label}`, 'info');
                printLine(`  Type:        ${wNode.type.toUpperCase()}`, 'info');
                printLine(`  Position:    (${Math.round(wNode.x)}, ${Math.round(wNode.y)})`, 'info');
                printLine(`  OS:          ${wns.os}`, 'info');
                printLine(`  State:       ${wns.state.toUpperCase()}`, wns.state === 'normal' ? 'success' : 'warning');
                printLine(`  Health:      ${Math.round(wns.health)}%`, wns.health > 60 ? 'success' : 'error');
                printLine(`  Open Ports:  ${wns.ports.join(', ')}`, 'info');
                printLine(`  Services:    ${wns.services.join(', ')}`, 'info');
                printLine(`  Shield:      ${wns.shield ? 'ACTIVE' : 'OFF'}`, wns.shield ? 'defense' : 'dim');
                printLine(`  Firewall:    ${wns.firewall ? 'ACTIVE' : 'OFF'}`, wns.firewall ? 'defense' : 'dim');
                printLine(`  Monitoring:  ${wns.monitor ? 'ACTIVE' : 'OFF'}`, wns.monitor ? 'cyan' : 'dim');
                printLine(`  Connections: ${connNodes.join(', ') || 'None'}`, 'info');
                printSeparator();
                ensureAnimating();
                break;
            }

            // ─────────────── DOS ───────────────
            case 'dos': {
                const dosTarget = args[0];
                const dosPps = parseInt(args[1]) || 1000;
                if (!dosTarget) { printLine('Usage: dos <targetId> [pps]', 'warning'); break; }
                const dosNode = nodes.find(n => n.id === dosTarget);
                if (!dosNode) { printLine(`Target ${dosTarget} not found.`, 'error'); break; }

                // Find attacker node or use first available
                let attackerNode = nodes.find(n => n.type === 'attacker');
                if (!attackerNode) {
                    printLine('No attacker node found. Auto-deploying...', 'warning');
                    addNode('attacker', dosNode.x - 200, dosNode.y - 100);
                    attackerNode = nodes[nodes.length - 1];
                    const nearRouter = nodes.find(n => n.type === 'router' || n.type === 'switch');
                    if (nearRouter) {
                        links.push({ id:'l_'+Date.now(), from:attackerNode.id, to:nearRouter.id });
                        updateCounters();
                    }
                }

                const targetState = getNodeState(dosTarget);
                targetState.state = 'under_attack';
                targetState.health = Math.max(targetState.health, 50);
                addNodeEffect(dosTarget, { type: 'shake', amplitude: 6, duration: 30000 });
                addNodeEffect(dosTarget, { type: 'pulse', color: '#ef4444', duration: 30000, count: 4 });

                // Attack particles
                const atkId = 'atk_' + Date.now();
                activeAttacks[atkId] = {
                    from: attackerNode.id,
                    to: dosTarget,
                    pps: dosPps,
                    type: 'dos',
                    intervalId: setInterval(() => {
                        const fromN = nodes.find(n => n.id === attackerNode.id);
                        const toN = nodes.find(n => n.id === dosTarget);
                        if (fromN && toN) {
                            for (let i = 0; i < 3; i++) spawnAttackParticle(fromN, toN);
                        }
                    }, 100)
                };

                // Red glow on links in path
                const atkPath = findPath(attackerNode.id, dosTarget);
                if (atkPath) {
                    for (let i = 0; i < atkPath.length - 1; i++) {
                        const lnk = findLinkBetween(atkPath[i], atkPath[i+1]);
                        if (lnk) addLinkEffect(lnk.id, { type: 'attack_flow', duration: 30000 });
                    }
                }

                printLine(`⚔  DoS ATTACK launched on ${dosTarget} (${dosNode.label})`, 'attack');
                printLine(`   Rate: ${dosPps} PPS | Source: ${attackerNode.id}`, 'warning');
                printLine(`   Target state: UNDER ATTACK`, 'error');
                logEvent('attack', `DoS attack on ${dosTarget} at ${dosPps} PPS`);
                showToast(`DoS Attack on ${dosNode.label}!`, 'error');
                
                // Trigger real simulation
                await executeTerminalAttackSimulation('udp_flood', dosTarget, dosPps);
                ensureAnimating();
                break;
            }

            // ─────────────── DDOS ───────────────
            case 'ddos': {
                const ddosPps = parseInt(args[0]) || 1000;
                const attackers = nodes.filter(n => n.type === 'attacker');
                const server = nodes.find(n => n.type === 'server');
                if (!server) { printLine('No server node found as target.', 'error'); break; }
                if (attackers.length === 0) { printLine('No attacker nodes in topology. Use "add attacker" first.', 'error'); break; }

                const serverState = getNodeState(server.id);
                serverState.state = 'under_attack';
                addNodeEffect(server.id, { type: 'shake', amplitude: 8, duration: 30000 });
                addNodeEffect(server.id, { type: 'pulse', color: '#ef4444', duration: 30000, count: 5 });

                printLine(`⚔  DDoS ATTACK launched! ${attackers.length} sources → ${server.id}`, 'attack');
                attackers.forEach(atk => {
                    const atkId = 'atk_' + Date.now() + '_' + atk.id;
                    activeAttacks[atkId] = {
                        from: atk.id, to: server.id, pps: ddosPps, type: 'ddos',
                        intervalId: setInterval(() => {
                            const fromN = nodes.find(n => n.id === atk.id);
                            const toN = nodes.find(n => n.id === server.id);
                            if (fromN && toN) for (let i = 0; i < 4; i++) spawnAttackParticle(fromN, toN);
                        }, 80)
                    };
                    const path = findPath(atk.id, server.id);
                    if (path) {
                        for (let i = 0; i < path.length - 1; i++) {
                            const lnk = findLinkBetween(path[i], path[i+1]);
                            if (lnk) addLinkEffect(lnk.id, { type: 'attack_flow', duration: 30000 });
                        }
                    }
                    printLine(`   Source: ${atk.id} (${atk.label}) → ${ddosPps} PPS`, 'warning');
                });
                logEvent('attack', `DDoS attack: ${attackers.length} sources at ${ddosPps} PPS each`);
                showToast(`DDoS Attack! ${attackers.length} sources!`, 'error');
                
                // Trigger real simulation
                await executeTerminalAttackSimulation('amplification', server.id, ddosPps * attackers.length);
                ensureAnimating();
                break;
            }

            // ─────────────── SYNFLOOD ───────────────
            case 'synflood': {
                const sfTarget = args[0];
                if (!sfTarget) { printLine('Usage: synflood <targetId>', 'warning'); break; }
                const sfNode = nodes.find(n => n.id === sfTarget);
                if (!sfNode) { printLine(`Node ${sfTarget} not found.`, 'error'); break; }
                const sfState = getNodeState(sfTarget);
                sfState.state = 'under_attack';
                addNodeEffect(sfTarget, { type: 'shake', amplitude: 4, duration: 20000 });
                addNodeEffect(sfTarget, { type: 'pulse', color: '#f97316', duration: 20000, count: 6 });

                printLine(`⚔  SYN FLOOD attack on ${sfTarget} (${sfNode.label})`, 'attack');
                printLine(`   Sending SYN packets... connection table filling up`, 'warning');

                let synCount = 0;
                const synInterval = setInterval(() => {
                    synCount += Math.floor(Math.random() * 500) + 500;
                    printLine(`   [SYN] ${synCount} half-open connections...`, 'error');
                    sfState.health = Math.max(0, sfState.health - 2);
                    if (synCount > 5000 || sfState.health <= 0) {
                        clearInterval(synInterval);
                        if (sfState.health <= 0) {
                            sfState.state = 'compromised';
                            printLine(`   ☠ ${sfTarget} connection table EXHAUSTED — service DOWN`, 'error');
                        } else {
                            printLine(`   SYN flood stopped.`, 'warning');
                        }
                    }
                }, 800);
                logEvent('attack', `SYN flood on ${sfTarget}`);
                
                // Trigger real simulation
                await executeTerminalAttackSimulation('syn_flood', sfTarget, 2000);
                ensureAnimating();
                break;
            }

            // ─────────────── SLOWLORIS ───────────────
            case 'slowloris': {
                const slTarget = args[0];
                if (!slTarget) { printLine('Usage: slowloris <targetId>', 'warning'); break; }
                const slNode = nodes.find(n => n.id === slTarget);
                if (!slNode) { printLine(`Node ${slTarget} not found.`, 'error'); break; }
                const slState = getNodeState(slTarget);
                slState.state = 'under_attack';
                addNodeEffect(slTarget, { type: 'pulse', color: '#f59e0b', duration: 15000, count: 2 });

                printLine(`⚔  SLOWLORIS attack on ${slTarget} (${slNode.label})`, 'attack');
                printLine(`   Opening slow HTTP connections...`, 'warning');

                let conns = 0;
                const slInterval = setInterval(() => {
                    conns += Math.floor(Math.random() * 50) + 20;
                    printLine(`   [SLOWLORIS] ${conns} persistent connections held open...`, 'warning');
                    slState.health = Math.max(5, slState.health - 1.5);
                    if (conns > 1000) {
                        clearInterval(slInterval);
                        printLine(`   HTTP server resources exhausted.`, 'error');
                    }
                }, 1000);
                logEvent('attack', `Slowloris attack on ${slTarget}`);
                
                // Trigger real simulation
                await executeTerminalAttackSimulation('slowloris', slTarget, 500);
                ensureAnimating();
                break;
            }

            // ─────────────── UDPFLOOD ───────────────
            case 'udpflood': {
                const target = args[0];
                if (!target) { printLine('Usage: udpflood <targetId>', 'warning'); break; }
                if (!nodes.find(n => n.id === target)) { printLine(`Target not found.`, 'error'); break; }
                printLine(`⚔  UDP FLOOD attack on ${target}`, 'attack');
                addNodeEffect(target, { type: 'shake', amplitude: 5, duration: 15000 });
                await executeTerminalAttackSimulation('udp_flood', target, 1500);
                ensureAnimating();
                break;
            }

            // ─────────────── ICMPFLOOD ───────────────
            case 'icmpflood': {
                const target = args[0];
                if (!target) { printLine('Usage: icmpflood <targetId>', 'warning'); break; }
                if (!nodes.find(n => n.id === target)) { printLine(`Target not found.`, 'error'); break; }
                printLine(`⚔  ICMP FLOOD (Ping of Death) on ${target}`, 'attack');
                addNodeEffect(target, { type: 'shake', amplitude: 3, duration: 15000 });
                await executeTerminalAttackSimulation('icmp_flood', target, 2000);
                ensureAnimating();
                break;
            }

            // ─────────────── HTTPFLOOD ───────────────
            case 'httpflood': {
                const target = args[0];
                if (!target) { printLine('Usage: httpflood <targetId>', 'warning'); break; }
                if (!nodes.find(n => n.id === target)) { printLine(`Target not found.`, 'error'); break; }
                printLine(`⚔  HTTP GET FLOOD attack on ${target}`, 'attack');
                addNodeEffect(target, { type: 'pulse', color: '#f97316', duration: 15000, count: 4 });
                await executeTerminalAttackSimulation('http_flood', target, 800);
                ensureAnimating();
                break;
            }

            // ─────────────── AMPLIFICATION ───────────────
            case 'amplification': {
                const target = args[0];
                if (!target) { printLine('Usage: amplification <targetId>', 'warning'); break; }
                if (!nodes.find(n => n.id === target)) { printLine(`Target not found.`, 'error'); break; }
                printLine(`⚔  DNS/NTP AMPLIFICATION attack on ${target}`, 'attack');
                addNodeEffect(target, { type: 'shake', amplitude: 8, duration: 20000 });
                addNodeEffect(target, { type: 'pulse', color: '#ef4444', duration: 20000, count: 5 });
                await executeTerminalAttackSimulation('amplification', target, 3000);
                ensureAnimating();
                break;
            }

            // ─────────────── MITM ───────────────
            case 'mitm': {
                const mitmA = args[0], mitmB = args[1];
                if (!mitmA || !mitmB) { printLine('Usage: mitm <nodeId1> <nodeId2>', 'warning'); break; }
                const nodeA = nodes.find(n => n.id === mitmA);
                const nodeB = nodes.find(n => n.id === mitmB);
                if (!nodeA || !nodeB) { printLine('One or both nodes not found.', 'error'); break; }
                const mitmLink = findLinkBetween(mitmA, mitmB);
                if (!mitmLink) { printLine(`No direct link between ${mitmA} and ${mitmB}.`, 'error'); break; }

                addLinkEffect(mitmLink.id, { type: 'mitm', duration: 30000 });
                addNodeEffect(mitmA, { type: 'pulse', color: '#a855f7', duration: 5000, count: 3 });
                addNodeEffect(mitmB, { type: 'pulse', color: '#a855f7', duration: 5000, count: 3 });

                printLine(`⚔  MAN-IN-THE-MIDDLE attack on ${mitmA} ↔ ${mitmB}`, 'attack');
                printLine(`   Intercepting traffic between ${nodeA.label} and ${nodeB.label}`, 'warning');
                printLine(`   ARP spoofing active...`, 'warning');

                let intercepted = 0;
                const mitmInterval = setInterval(() => {
                    intercepted += Math.floor(Math.random() * 20) + 10;
                    if (Math.random() < 0.3) {
                        printLine(`   [MITM] Captured ${intercepted} packets | Credentials detected!`, 'error');
                    }
                }, 2000);
                setTimeout(() => clearInterval(mitmInterval), 20000);

                logEvent('attack', `MITM attack: ${mitmA} ↔ ${mitmB}`);
                ensureAnimating();
                break;
            }

            // ─────────────── DNS_SPOOF ───────────────
            case 'dns_spoof': {
                const dnsTarget = args[0] || (nodes.find(n => n.type === 'server')?.id);
                if (!dnsTarget) { printLine('Usage: dns_spoof [targetId] or need a server in topology', 'warning'); break; }
                const dnsNode = nodes.find(n => n.id === dnsTarget);
                if (!dnsNode) { printLine(`Node ${dnsTarget} not found.`, 'error'); break; }
                addNodeEffect(dnsTarget, { type: 'pulse', color: '#a855f7', duration: 5000, count: 3 });
                addNodeEffect(dnsTarget, { type: 'highlight', color: '#a855f7', duration: 3000 });
                printLine(`⚔  DNS SPOOFING attack on ${dnsTarget} (${dnsNode.label})`, 'attack');
                printLine(`   Poisoning DNS cache... redirecting traffic`, 'warning');
                printLine(`   Victims will be redirected to malicious server`, 'error');
                logEvent('attack', `DNS spoofing on ${dnsTarget}`);
                ensureAnimating();
                break;
            }

            // ─────────────── BRUTEFORCE ───────────────
            case 'bruteforce': {
                const bfTarget = args[0];
                if (!bfTarget) { printLine('Usage: bruteforce <targetId>', 'warning'); break; }
                const bfNode = nodes.find(n => n.id === bfTarget);
                if (!bfNode) { printLine(`Node ${bfTarget} not found.`, 'error'); break; }
                const bfState = getNodeState(bfTarget);
                addNodeEffect(bfTarget, { type: 'bruteforce', duration: 8000 });
                addNodeEffect(bfTarget, { type: 'pulse', color: '#ef4444', duration: 8000, count: 3 });

                printLine(`⚔  BRUTEFORCE attack on ${bfTarget} (${bfNode.label})`, 'attack');
                const passwords = ['admin', 'password', '123456', 'root', 'letmein', 'qwerty', 'admin123'];
                let attempt = 0;
                const bfInterval = setInterval(() => {
                    if (attempt < passwords.length) {
                        printLine(`   [AUTH] Trying "${passwords[attempt]}"... DENIED`, 'warning');
                        attempt++;
                    } else {
                        clearInterval(bfInterval);
                        if (bfState.firewall || bfState.shield) {
                            printLine(`   ✗ Brute force BLOCKED by defenses`, 'defense');
                        } else {
                            printLine(`   ☠ ACCESS GRANTED with "admin123"!`, 'error');
                            bfState.state = 'compromised';
                            bfState.health = 20;
                        }
                    }
                }, 600);
                logEvent('attack', `Bruteforce attack on ${bfTarget}`);
                ensureAnimating();
                break;
            }

            // ─────────────── DEAUTH ───────────────
            case 'deauth': {
                const daId = args[0];
                if (!daId) { printLine('Usage: deauth <nodeId>', 'warning'); break; }
                const daNode = nodes.find(n => n.id === daId);
                if (!daNode) { printLine(`Node ${daId} not found.`, 'error'); break; }
                addNodeEffect(daId, { type: 'shake', amplitude: 8, duration: 3000 });
                addNodeEffect(daId, { type: 'pulse', color: '#ef4444', duration: 3000, count: 5 });

                // Temporarily disable links
                const daLinks = links.filter(l => l.from === daId || l.to === daId);
                daLinks.forEach(l => addLinkEffect(l.id, { type: 'blocked', duration: 5000 }));

                printLine(`⚔  DEAUTH attack on ${daId} (${daNode.label})`, 'attack');
                printLine(`   Sending deauthentication frames... Node disconnected temporarily`, 'warning');
                logEvent('attack', `Deauth attack on ${daId}`);
                ensureAnimating();
                break;
            }

            // ─────────────── STOP_ATTACK ───────────────
            case 'stop_attack': {
                const stopTarget = args[0];
                if (stopTarget) {
                    let stopped = 0;
                    Object.keys(activeAttacks).forEach(aid => {
                        if (activeAttacks[aid].to === stopTarget) {
                            clearInterval(activeAttacks[aid].intervalId);
                            delete activeAttacks[aid];
                            stopped++;
                        }
                    });
                    if (stopped > 0) {
                        const tState = getNodeState(stopTarget);
                        tState.state = tState.health > 0 ? 'normal' : 'compromised';
                        clearNodeEffects(stopTarget);
                        // Clear link effects
                        Object.keys(linkEffects).forEach(lid => {
                            linkEffects[lid].effects = linkEffects[lid].effects.filter(e => e.type !== 'attack_flow');
                        });
                        printLine(`✓ Stopped ${stopped} attack(s) on ${stopTarget}`, 'success');
                        logEvent('defense', `Stopped attacks on ${stopTarget}`);
                    } else {
                        printLine(`No active attacks on ${stopTarget}.`, 'warning');
                    }
                } else {
                    // Stop all attacks
                    let count = Object.keys(activeAttacks).length;
                    Object.keys(activeAttacks).forEach(aid => {
                        clearInterval(activeAttacks[aid].intervalId);
                        const tState = getNodeState(activeAttacks[aid].to);
                        tState.state = tState.health > 0 ? 'normal' : 'compromised';
                        clearNodeEffects(activeAttacks[aid].to);
                        delete activeAttacks[aid];
                    });
                    Object.keys(linkEffects).forEach(lid => {
                        linkEffects[lid].effects = linkEffects[lid].effects.filter(e => e.type !== 'attack_flow');
                    });
                    printLine(`✓ Stopped all ${count} attacks.`, 'success');
                    logEvent('defense', `Stopped all attacks`);
                }
                draw();
                break;
            }

            // ─────────────── SHIELD ───────────────
            case 'shield': {
                const shId = args[0];
                if (!shId) { printLine('Usage: shield <nodeId>', 'warning'); break; }
                const shNode = nodes.find(n => n.id === shId);
                if (!shNode) { printLine(`Node ${shId} not found.`, 'error'); break; }
                const shState = getNodeState(shId);
                shState.shield = !shState.shield;
                if (shState.shield) {
                    if (shState.state === 'under_attack') shState.state = 'defending';
                    else if (shState.state === 'normal') shState.state = 'protected';
                    addNodeEffect(shId, { type: 'pulse', color: '#10b981', duration: 2000, count: 3 });
                    addNodeEffect(shId, { type: 'highlight', color: '#10b981', duration: 1500 });
                    printLine(`🛡  Shield ACTIVATED on ${shId} (${shNode.label})`, 'defense');
                    logEvent('defense', `Shield activated on ${shId}`);
                    showToast(`Shield active on ${shNode.label}`, 'success');
                } else {
                    if (shState.state === 'protected') shState.state = 'normal';
                    else if (shState.state === 'defending') shState.state = 'under_attack';
                    printLine(`Shield DEACTIVATED on ${shId}`, 'warning');
                    logEvent('defense', `Shield deactivated on ${shId}`);
                }
                if (selectedNode?.id === shId) showProperties(shNode);
                updateTopologyList(); draw();
                ensureAnimating();
                break;
            }

            // ─────────────── FIREWALL ───────────────
            case 'firewall': {
                const fwId = args[0];
                if (!fwId) { printLine('Usage: firewall <nodeId>', 'warning'); break; }
                const fwNode = nodes.find(n => n.id === fwId);
                if (!fwNode) { printLine(`Node ${fwId} not found.`, 'error'); break; }
                const fwState = getNodeState(fwId);
                fwState.firewall = !fwState.firewall;
                if (fwState.firewall) {
                    addNodeEffect(fwId, { type: 'pulse', color: '#f59e0b', duration: 2000, count: 3 });
                    addNodeEffect(fwId, { type: 'highlight', color: '#f59e0b', duration: 1500 });
                    printLine(`🔥 Firewall ENABLED on ${fwId} (${fwNode.label})`, 'defense');
                    logEvent('defense', `Firewall enabled on ${fwId}`);
                } else {
                    printLine(`Firewall DISABLED on ${fwId}`, 'warning');
                    logEvent('defense', `Firewall disabled on ${fwId}`);
                }
                if (selectedNode?.id === fwId) showProperties(fwNode);
                updateTopologyList(); draw();
                ensureAnimating();
                break;
            }

            // ─────────────── IDS ───────────────
            case 'ids': {
                const idsMode = args[0]?.toLowerCase();
                if (idsMode === 'off') {
                    globalIDS = false;
                    nodes.forEach(n => getNodeState(n.id).idsActive = false);
                    printLine('🔍 Intrusion Detection System DISABLED', 'warning');
                    logEvent('defense', 'IDS disabled');
                } else {
                    globalIDS = true;
                    nodes.forEach(n => {
                        const ns = getNodeState(n.id);
                        ns.idsActive = true;
                        addNodeEffect(n.id, { type: 'pulse', color: '#3b82f6', duration: 2000, count: 2 });
                    });
                    printLine('🔍 Intrusion Detection System ENABLED on all nodes', 'defense');
                    logEvent('defense', 'IDS enabled globally');
                }
                draw();
                ensureAnimating();
                break;
            }

            // ─────────────── BLOCK ───────────────
            case 'block': {
                const blId = args[0];
                if (!blId) { printLine('Usage: block <nodeId>', 'warning'); break; }
                const blNode = nodes.find(n => n.id === blId);
                if (!blNode) { printLine(`Node ${blId} not found.`, 'error'); break; }
                const blState = getNodeState(blId);
                blState.state = 'blocked';
                blState.health = Math.max(blState.health, 1);
                // Block all links to this node
                links.filter(l => l.from === blId || l.to === blId).forEach(l => {
                    addLinkEffect(l.id, { type: 'blocked', duration: 999999 });
                });
                // Stop attacks from this node
                Object.keys(activeAttacks).forEach(aid => {
                    if (activeAttacks[aid].from === blId) {
                        clearInterval(activeAttacks[aid].intervalId);
                        delete activeAttacks[aid];
                    }
                });
                addNodeEffect(blId, { type: 'highlight', color: '#6b7280', duration: 2000 });
                printLine(`⊘ Node ${blId} (${blNode.label}) BLOCKED`, 'defense');
                logEvent('defense', `Blocked node ${blId}`);
                updateTopologyList(); draw();
                ensureAnimating();
                break;
            }

            // ─────────────── UNBLOCK ───────────────
            case 'unblock': {
                const ubId = args[0];
                if (!ubId) { printLine('Usage: unblock <nodeId>', 'warning'); break; }
                const ubNode = nodes.find(n => n.id === ubId);
                if (!ubNode) { printLine(`Node ${ubId} not found.`, 'error'); break; }
                const ubState = getNodeState(ubId);
                ubState.state = 'normal';
                // Remove blocked effects from links
                links.filter(l => l.from === ubId || l.to === ubId).forEach(l => {
                    if (linkEffects[l.id]) {
                        linkEffects[l.id].effects = linkEffects[l.id].effects.filter(e => e.type !== 'blocked');
                    }
                });
                addNodeEffect(ubId, { type: 'pulse', color: '#10b981', duration: 1500, count: 2 });
                printLine(`✓ Node ${ubId} UNBLOCKED`, 'success');
                logEvent('defense', `Unblocked node ${ubId}`);
                updateTopologyList(); draw();
                ensureAnimating();
                break;
            }

            // ─────────────── RATE_LIMIT ───────────────
            case 'rate_limit': {
                const rlId = args[0];
                const rlRate = parseInt(args[1]) || 100;
                if (!rlId) { printLine('Usage: rate_limit <nodeId> <rate>', 'warning'); break; }
                const rlNode = nodes.find(n => n.id === rlId);
                if (!rlNode) { printLine(`Node ${rlId} not found.`, 'error'); break; }
                const rlState = getNodeState(rlId);
                rlState.rateLimit = rlRate;
                addNodeEffect(rlId, { type: 'pulse', color: '#8b5cf6', duration: 2000, count: 2 });
                printLine(`⏱  Rate limit set on ${rlId}: ${rlRate} pps`, 'defense');
                logEvent('defense', `Rate limit ${rlRate} pps on ${rlId}`);
                if (selectedNode?.id === rlId) showProperties(rlNode);
                draw();
                ensureAnimating();
                break;
            }

            // ─────────────── DTAF ───────────────
            case 'dtaf': {
                const dtafMode = args[0]?.toLowerCase();
                if (dtafMode === 'off') {
                    globalDTAF = false;
                    printLine('DTAF Adaptive Defense System DISABLED', 'warning');
                    logEvent('defense', 'DTAF disabled');
                } else {
                    globalDTAF = true;
                    nodes.forEach(n => {
                        if (n.type === 'router' || n.type === 'firewall') {
                            const ns = getNodeState(n.id);
                            ns.shield = true;
                            ns.firewall = true;
                            ns.state = 'protected';
                            addNodeEffect(n.id, { type: 'pulse', color: '#10b981', duration: 3000, count: 4 });
                        }
                    });
                    printLine('🛡  DTAF Adaptive Defense System ENABLED', 'defense');
                    printLine('   All routers and firewalls: Shield + Firewall activated', 'success');
                    printLine('   Dynamic threshold learning: ACTIVE', 'success');
                    logEvent('defense', 'DTAF enabled');
                    showToast('DTAF Defense Activated!', 'success');
                }
                updateTopologyList(); draw();
                ensureAnimating();
                break;
            }

            // ─────────────── QUARANTINE ───────────────
            case 'quarantine': {
                const qId = args[0];
                if (!qId) { printLine('Usage: quarantine <nodeId>', 'warning'); break; }
                const qNode = nodes.find(n => n.id === qId);
                if (!qNode) { printLine(`Node ${qId} not found.`, 'error'); break; }
                const qState = getNodeState(qId);
                qState.state = 'quarantined';
                // Block all links
                links.filter(l => l.from === qId || l.to === qId).forEach(l => {
                    addLinkEffect(l.id, { type: 'blocked', duration: 999999 });
                });
                addNodeEffect(qId, { type: 'pulse', color: '#f97316', duration: 3000, count: 3 });
                printLine(`🔒 Node ${qId} (${qNode.label}) QUARANTINED`, 'warning');
                printLine(`   All connections severed. Node isolated.`, 'info');
                logEvent('defense', `Quarantined ${qId}`);
                updateTopologyList(); draw();
                ensureAnimating();
                break;
            }

            // ─────────────── PATCH ───────────────
            case 'patch': {
                const pId = args[0];
                if (!pId) { printLine('Usage: patch <nodeId>', 'warning'); break; }
                const pNode = nodes.find(n => n.id === pId);
                if (!pNode) { printLine(`Node ${pId} not found.`, 'error'); break; }
                const pState = getNodeState(pId);
                printLine(`🔧 Patching ${pId} (${pNode.label})...`, 'system');

                addNodeEffect(pId, { type: 'scan', duration: 3000 });
                addNodeEffect(pId, { type: 'pulse', color: '#10b981', duration: 3000, count: 3 });

                setTimeout(() => {
                    pState.state = 'normal';
                    pState.health = 100;
                    // Remove blocked link effects
                    links.filter(l => l.from === pId || l.to === pId).forEach(l => {
                        if (linkEffects[l.id]) {
                            linkEffects[l.id].effects = linkEffects[l.id].effects.filter(e => e.type !== 'blocked');
                        }
                    });
                    printLine(`✓ Node ${pId} patched and restored to full health`, 'success');
                    logEvent('defense', `Patched ${pId}`);
                    if (selectedNode?.id === pId) showProperties(pNode);
                    updateTopologyList();
                    draw();
                }, 3000);
                ensureAnimating();
                break;
            }

            // ─────────────── HONEYPOT ───────────────
            case 'honeypot': {
                const hpId = args[0];
                if (!hpId) { printLine('Usage: honeypot <nodeId>', 'warning'); break; }
                const hpNode = nodes.find(n => n.id === hpId);
                if (!hpNode) { printLine(`Node ${hpId} not found.`, 'error'); break; }
                addNodeEffect(hpId, { type: 'pulse', color: '#eab308', duration: 5000, count: 2 });
                printLine(`🍯 Honeypot deployed on ${hpId} (${hpNode.label})`, 'defense');
                printLine(`   Monitoring for intrusion attempts...`, 'info');
                logEvent('defense', `Honeypot deployed on ${hpId}`);
                ensureAnimating();
                break;
            }

            // ─────────────── MONITOR ───────────────
            case 'monitor': {
                const monMode = args[0]?.toLowerCase();
                if (monMode === 'off') {
                    globalMonitoring = false;
                    nodes.forEach(n => getNodeState(n.id).monitor = false);
                    printLine('📡 Global monitoring DISABLED', 'warning');
                    logEvent('monitor', 'Monitoring disabled');
                } else {
                    globalMonitoring = true;
                    nodes.forEach(n => {
                        const ns = getNodeState(n.id);
                        ns.monitor = true;
                        addNodeEffect(n.id, { type: 'pulse', color: '#eab308', duration: 2000, count: 2 });
                    });
                    printLine('📡 Global monitoring ENABLED', 'success');
                    printLine('   All nodes are being monitored in real-time', 'info');
                    logEvent('monitor', 'Monitoring enabled');
                }
                if (selectedNode) showProperties(selectedNode);
                draw();
                ensureAnimating();
                break;
            }

            // ─────────────── STATUS ───────────────
            case 'status': {
                const stId = args[0];
                if (stId) {
                    const stNode = nodes.find(n => n.id === stId);
                    if (!stNode) { printLine(`Node ${stId} not found.`, 'error'); break; }
                    const stn = getNodeState(stId);
                    addNodeEffect(stId, { type: 'highlight', color: '#6366f1', duration: 1500 });
                    printSeparator();
                    printLine(`  Status: ${stId} (${stNode.label})`, 'system');
                    printSeparator();
                    printLine(`  Type:      ${stNode.type.toUpperCase()}`, 'info');
                    printLine(`  State:     ${stn.state.replace(/_/g,' ').toUpperCase()}`, stn.state === 'normal' ? 'success' : stn.state === 'protected' ? 'defense' : 'error');
                    printLine(`  Health:    ${Math.round(stn.health)}%`, stn.health > 60 ? 'success' : 'error');
                    printLine(`  Shield:    ${stn.shield ? 'ON' : 'OFF'}`, stn.shield ? 'defense' : 'dim');
                    printLine(`  Firewall:  ${stn.firewall ? 'ON' : 'OFF'}`, stn.firewall ? 'defense' : 'dim');
                    printLine(`  Monitor:   ${stn.monitor ? 'ON' : 'OFF'}`, stn.monitor ? 'cyan' : 'dim');
                    printSeparator();
                } else {
                    // Network status
                    printSeparator();
                    printLine(`  NETWORK STATUS`, 'system');
                    printSeparator();
                    printLine(`  Nodes:          ${nodes.length}`, 'info');
                    printLine(`  Links:          ${links.length}`, 'info');
                    printLine(`  Active Attacks: ${Object.keys(activeAttacks).length}`, Object.keys(activeAttacks).length > 0 ? 'error' : 'success');
                    printLine(`  DTAF:           ${globalDTAF ? 'ENABLED' : 'DISABLED'}`, globalDTAF ? 'defense' : 'dim');
                    printLine(`  IDS:            ${globalIDS ? 'ENABLED' : 'DISABLED'}`, globalIDS ? 'scan' : 'dim');
                    printLine(`  Monitoring:     ${globalMonitoring ? 'ENABLED' : 'DISABLED'}`, globalMonitoring ? 'cyan' : 'dim');
                    const compromised = nodes.filter(n => getNodeState(n.id).state === 'compromised').length;
                    const underAttack = nodes.filter(n => getNodeState(n.id).state === 'under_attack').length;
                    const protected_ = nodes.filter(n => getNodeState(n.id).shield || getNodeState(n.id).firewall).length;
                    printLine(`  Compromised:    ${compromised}`, compromised > 0 ? 'error' : 'success');
                    printLine(`  Under Attack:   ${underAttack}`, underAttack > 0 ? 'warning' : 'success');
                    printLine(`  Protected:      ${protected_}`, 'defense');
                    printSeparator();
                }
                ensureAnimating();
                break;
            }

            // ─────────────── TRAFFIC ───────────────
            case 'traffic': {
                printSeparator();
                printLine('  TRAFFIC ANALYSIS', 'system');
                printSeparator();
                nodes.forEach(n => {
                    const ns = getNodeState(n.id);
                    const connCount = links.filter(l => l.from === n.id || l.to === n.id).length;
                    const bar = '█'.repeat(Math.min(20, connCount * 4)) + '░'.repeat(Math.max(0, 20 - connCount * 4));
                    const inAttack = Object.values(activeAttacks).some(a => a.to === n.id);
                    printLine(`  ${n.id.padEnd(6)} [${bar}] ${connCount} links ${inAttack ? '⚠ ATTACK' : ''}`, inAttack ? 'error' : 'info');
                });
                printSeparator();
                break;
            }

            // ─────────────── STATS ───────────────
            case 'stats': {
                const totalNodes = nodes.length;
                const types = {};
                nodes.forEach(n => { types[n.type] = (types[n.type] || 0) + 1; });
                printSeparator();
                printLine('  NETWORK STATISTICS', 'system');
                printSeparator();
                printLine(`  Total Nodes: ${totalNodes}`, 'info');
                Object.entries(types).forEach(([t, c]) => {
                    printLine(`    ${t.padEnd(12)} ${c}`, 'info');
                });
                printLine(`  Total Links: ${links.length}`, 'info');
                printLine(`  Active Attacks: ${Object.keys(activeAttacks).length}`, Object.keys(activeAttacks).length > 0 ? 'error' : 'success');
                printLine(`  Events Logged: ${eventLog.length}`, 'info');
                printSeparator();
                break;
            }

            // ─────────────── LOG ───────────────
            case 'log': {
                const logCount = parseInt(args[0]) || 15;
                const recent = eventLog.slice(-logCount);
                if (recent.length === 0) { printLine('No events logged yet.', 'dim'); break; }
                printSeparator();
                printLine('  EVENT LOG', 'system');
                printSeparator();
                recent.forEach(ev => {
                    const typeColor = { attack: 'attack', defense: 'defense', scan: 'scan', info: 'info', critical: 'error', monitor: 'cyan' };
                    printLine(`  [${ev.time}] [${ev.type.toUpperCase().padEnd(8)}] ${ev.message}`, typeColor[ev.type] || 'info');
                });
                printSeparator();
                break;
            }

            // ─────────────── ALERTS ───────────────
            case 'alerts': {
                const attackedNodes = nodes.filter(n => {
                    const ns = getNodeState(n.id);
                    return ns.state === 'under_attack' || ns.state === 'compromised';
                });
                if (attackedNodes.length === 0) {
                    printLine('✓ No active alerts. Network is secure.', 'success');
                } else {
                    printSeparator();
                    printLine('  ⚠ ACTIVE ALERTS', 'error');
                    printSeparator();
                    attackedNodes.forEach(n => {
                        const ns = getNodeState(n.id);
                        const icon = ns.state === 'compromised' ? '☠' : '⚠';
                        printLine(`  ${icon} ${n.id} (${n.label}): ${ns.state.replace(/_/g,' ').toUpperCase()} | Health: ${Math.round(ns.health)}%`, 'error');
                    });
                    printLine(`  Active attacks: ${Object.keys(activeAttacks).length}`, 'warning');
                    printSeparator();
                }
                break;
            }

            // ─────────────── ISOLATE ───────────────
            case 'isolate': {
                const isoId = args[0];
                if (!isoId) { printLine('Usage: isolate <nodeId>', 'warning'); break; }
                const isoNode = nodes.find(n => n.id === isoId);
                if (!isoNode) { printLine(`Node ${isoId} not found.`, 'error'); break; }
                const removedLinks = links.filter(l => l.from === isoId || l.to === isoId);
                links = links.filter(l => l.from !== isoId && l.to !== isoId);
                removedLinks.forEach(l => delete linkEffects[l.id]);
                addNodeEffect(isoId, { type: 'pulse', color: '#f97316', duration: 2000, count: 3 });
                updateCounters(); updateTopologyList(); draw();
                printLine(`✓ Isolated ${isoId} (${isoNode.label}). Removed ${removedLinks.length} links.`, 'success');
                logEvent('info', `Isolated ${isoId}`);
                break;
            }

            // ─────────────── RESTORE ───────────────
            case 'restore': {
                const rsId = args[0];
                if (!rsId) { printLine('Usage: restore <nodeId>', 'warning'); break; }
                const rsNode = nodes.find(n => n.id === rsId);
                if (!rsNode) { printLine(`Node ${rsId} not found.`, 'error'); break; }
                const rsState = getNodeState(rsId);
                rsState.state = 'normal';
                rsState.health = 100;
                rsState.shield = false;
                rsState.firewall = false;
                rsState.monitor = false;
                rsState.rateLimit = 0;
                clearNodeEffects(rsId);
                // Remove link effects for this node's links
                links.filter(l => l.from === rsId || l.to === rsId).forEach(l => {
                    if (linkEffects[l.id]) linkEffects[l.id].effects = [];
                });
                addNodeEffect(rsId, { type: 'pulse', color: '#10b981', duration: 2000, count: 3 });
                addNodeEffect(rsId, { type: 'highlight', color: '#10b981', duration: 1500 });
                if (selectedNode?.id === rsId) showProperties(rsNode);
                updateTopologyList(); draw();
                printLine(`✓ Node ${rsId} restored to default state`, 'success');
                logEvent('info', `Restored ${rsId}`);
                ensureAnimating();
                break;
            }

            // ─────────────── LIST ───────────────
            case 'list': {
                const listType = args[0]?.toLowerCase();
                if (listType === 'links') {
                    if (links.length === 0) { printLine('No links.', 'dim'); break; }
                    printSeparator();
                    printLine('  LINKS', 'system');
                    printSeparator();
                    links.forEach(l => {
                        const fromN = nodes.find(n => n.id === l.from);
                        const toN = nodes.find(n => n.id === l.to);
                        printLine(`  ${l.id}: ${l.from} (${fromN?.label||'?'}) ↔ ${l.to} (${toN?.label||'?'})`, 'info');
                    });
                    printSeparator();
                } else {
                    if (nodes.length === 0) { printLine('No nodes.', 'dim'); break; }
                    printSeparator();
                    printLine('  NODES', 'system');
                    printSeparator();
                    nodes.forEach(n => {
                        const ns = getNodeState(n.id);
                        const stIcon = ns.state === 'under_attack' ? '⚠' : ns.state === 'protected' || ns.shield ? '🛡' : ns.state === 'compromised' ? '☠' : '●';
                        const connCount = links.filter(l => l.from === n.id || l.to === n.id).length;
                        printLine(`  ${stIcon} ${n.id.padEnd(6)} ${n.type.padEnd(10)} ${n.label.padEnd(18)} ${connCount} links  HP:${Math.round(ns.health)}%`, 'info');
                    });
                    printSeparator();
                }
                break;
            }

            // ─────────────── TOPOLOGY ───────────────
            case 'topology': {
                printSeparator();
                printLine('  TOPOLOGY SUMMARY', 'system');
                printSeparator();
                const types = {};
                nodes.forEach(n => { types[n.type] = (types[n.type] || 0) + 1; });
                printLine(`  Total Nodes: ${nodes.length}`, 'info');
                Object.entries(types).forEach(([t, c]) => {
                    const cfg = nodeConfig[t] || {};
                    printLine(`    ${cfg.icon || '?'} ${t.padEnd(12)} ${c}`, 'info');
                });
                printLine(`  Total Links: ${links.length}`, 'info');
                printLine(`  Connectivity: ${links.length > 0 ? 'Connected' : 'Disconnected'}`, links.length > 0 ? 'success' : 'warning');
                printSeparator();
                break;
            }

            // ─────────────── RESET ───────────────
            case 'reset': {
                clearAllEffects();
                particles = [];
                nodes.forEach(n => {
                    const ns = getNodeState(n.id);
                    ns.state = 'normal';
                    ns.health = 100;
                    ns.shield = false;
                    ns.firewall = false;
                    ns.monitor = false;
                    ns.rateLimit = 0;
                    ns.effects = [];
                });
                Object.keys(linkEffects).forEach(id => { linkEffects[id].effects = []; });
                globalMonitoring = false;
                globalIDS = false;
                globalDTAF = false;
                if (selectedNode) showProperties(selectedNode);
                updateTopologyList(); draw();
                printLine('✓ All states, effects, and attacks reset.', 'success');
                logEvent('info', 'Full reset performed');
                break;
            }

            // ─────────────── SIMULATE / ATTACK (NS2) ───────────────
            case 'simulate':
            case 'attack': {
                if (nodes.length === 0 || !nodes.some(n => n.type === 'server')) {
                    printLine('Error: Need at least 1 Server node.', 'error');
                    break;
                }
                let mode = 'none';
                let pps = 0;
                if (cmd === 'attack') {
                    pps = parseInt(args[0]) || 1000;
                    mode = args[1] || 'none';
                    if (!nodes.some(n => n.type === 'attacker')) {
                        printLine('No attacker found. Auto-deploying...', 'warning');
                        addNode('attacker', 100, 100);
                        const attackerId = 'n_' + nodeCounter;
                        const switchNode = nodes.find(n => n.type === 'switch' || n.type === 'router');
                        if (switchNode) {
                            links.push({ id:'l_'+Date.now(), from:attackerId, to:switchNode.id });
                            updateCounters(); draw();
                        }
                    }
                    printLine(`⚔ Initiating DoS Attack [${pps} PPS] — Mitigation: ${mode.toUpperCase()}`, 'warning');
                } else {
                    mode = args[0] || 'none';
                    printLine(`Running simulation — Mitigation: ${mode.toUpperCase()}`, 'info');
                }

                // Visual update: put network in simulation mode
                nodes.forEach(n => {
                    if (n.type === 'attacker' && pps > 0) {
                        getNodeState(n.id).state = 'under_attack';
                        addNodeEffect(n.id, { type: 'pulse', color: '#ef4444', duration: 10000, count: 3 });
                    } else if (n.type === 'server') {
                        addNodeEffect(n.id, { type: 'pulse', color: '#10b981', duration: 10000, count: 2 });
                    } else if (n.type === 'router' && mode === 'dtaf') {
                        const ns = getNodeState(n.id);
                        ns.shield = true;
                        ns.state = 'protected';
                        addNodeEffect(n.id, { type: 'pulse', color: '#10b981', duration: 10000, count: 2 });
                    }
                });
                ensureAnimating();

                if (document.getElementById('simDefenseMode')) document.getElementById('simDefenseMode').value = mode;
                if (document.getElementById('simAttackPps')) document.getElementById('simAttackPps').value = pps;

                printLine('> Compiling TCL script...', 'info');
                try {
                    const res = await fetch('/api/simulate_workspace', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            defense_mode: mode,
                            attack_pps: pps,
                            topology: { nodes, links }
                        })
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    printLine(`✓ Simulation complete!`, 'success');
                    printLine(`   Throughput: ${data.summary.avg_throughput} Kbps`, 'info');
                    printLine(`   Delay: ${data.summary.avg_delay} ms`, 'info');
                    printLine(`   Packet Loss: ${data.summary.avg_loss}%`, data.summary.avg_loss > 20 ? 'error' : 'success');
                    printLine(`   Delivery Rate: ${data.summary.delivery_rate}%`, 'info');
                    localStorage.setItem('dtaf_sim_results', JSON.stringify(data));

                    const simModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('simulateModal'));
                    document.getElementById('simLoading').classList.add('d-none');
                    document.getElementById('simResults').classList.remove('d-none');
                    document.getElementById('simPlaybackPanel').classList.remove('d-none');
                    document.getElementById('resThroughput').innerText = data.summary.avg_throughput + ' Kbps';
                    document.getElementById('resLoss').innerText = data.summary.avg_loss + '%';
                    document.getElementById('resDelay').innerText = data.summary.avg_delay + ' ms';
                    terminalOverlay.classList.add('d-none');
                    simModal.show();
                    if (data.events && data.events.length > 0) runPlayback(data.events);
                } catch (err) {
                    printLine(`Execution Error: ${err.message}`, 'error');
                    // Reset node states
                    nodes.forEach(n => {
                        const ns = getNodeState(n.id);
                        if (ns.state !== 'normal') { ns.state = 'normal'; ns.effects = []; }
                    });
                    draw();
                }
                break;
            }

            // ─────────────── ADVANCED & CREATIVE ───────────────
            case 'matrix': {
                const isMatrix = document.body.classList.toggle('matrix-theme');
                if (isMatrix) {
                    printLine('Wake up, Neo...', 'success');
                    printLine('The Matrix has you.', 'success');
                    printLine('Follow the white rabbit.', 'success');
                    logEvent('system', 'Matrix mode ENABLED');
                } else {
                    printLine('Matrix mode disabled. Returning to reality.', 'info');
                    logEvent('system', 'Matrix mode DISABLED');
                }
                break;
            }

            case 'pcap': {
                const targetId = args[0];
                if (!targetId) { printLine('Usage: pcap <targetId>', 'warning'); break; }
                const targetNode = nodes.find(n => n.id === targetId);
                if (!targetNode) { printLine(`Node ${targetId} not found.`, 'error'); break; }
                
                printLine(`> Starting packet capture on ${targetId}...`, 'info');
                addNodeEffect(targetId, { type: 'pulse', color: '#10b981', duration: 5000, count: 5 });
                ensureAnimating();
                
                let pkts = 0;
                const pcapInterval = setInterval(() => {
                    pkts++;
                    // Generate fake hex dump
                    const hex = Array.from({length: 16}, () => Math.floor(Math.random()*256).toString(16).padStart(2, '0')).join(' ');
                    const ascii = Array.from({length: 16}, () => {
                        const c = Math.floor(Math.random() * (126 - 32 + 1)) + 32;
                        return String.fromCharCode(c).replace(/[^a-zA-Z0-9]/g, '.');
                    }).join('');
                    
                    printLine(`[PCAP] 0x000${pkts}0:  ${hex}  |${ascii}|`, 'info');
                    
                    if (pkts >= 10) {
                        clearInterval(pcapInterval);
                        printLine(`> Capture complete. 10 packets written.`, 'success');
                    }
                }, 400);
                break;
            }

            case 'threat_map': {
                printLine('GLOBAL THREAT MAP INITIATED', 'error');
                printLine('WARNING: INCOMING APT STRIKES DETECTED', 'warning');
                
                // Spawn laser particles from edges to center or randomly
                let count = 0;
                const tmInterval = setInterval(() => {
                    count++;
                    const sx = Math.random() < 0.5 ? (Math.random() < 0.5 ? -50 : canvas.width + 50) : Math.random() * canvas.width;
                    const sy = sx <= 0 || sx >= canvas.width ? Math.random() * canvas.height : (Math.random() < 0.5 ? -50 : canvas.height + 50);
                    
                    const targetNode = pickRandom(nodes.filter(n => n.type !== 'attacker'));
                    if (targetNode) {
                        particles.push({
                            x: sx, y: sy,
                            targetX: targetNode.x, targetY: targetNode.y,
                            color: '#ef4444',
                            progress: 0,
                            speed: 0.05,
                            size: 5,
                            glow: true,
                        });
                        if (count % 3 === 0) {
                            addNodeEffect(targetNode.id, { type: 'shake', amplitude: 10, duration: 1000 });
                            addNodeEffect(targetNode.id, { type: 'highlight', color: '#ef4444', duration: 1000 });
                        }
                    }
                    ensureAnimating();
                    
                    if (count >= 30) {
                        clearInterval(tmInterval);
                        printLine('THREAT MAP SIMULATION COMPLETE', 'info');
                    }
                }, 150);
                break;
            }

            // ─────────────── DEFAULT ───────────────
            default:
                printLine(`Command not found: '${cmd}'. Type 'help' for available commands.`, 'error');
            }
        }
    }

})();

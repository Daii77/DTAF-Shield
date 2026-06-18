/* DTAF Shield — Main JS */
document.addEventListener('DOMContentLoaded', () => {

    // ===== Sidebar Toggle =====
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== sidebarToggle) {
                sidebar.classList.remove('open');
            }
        });
    }

    // ===== Simulation Page =====
    const simForm = document.getElementById('simulationForm');
    if (!simForm) return;

    // Mode selector
    const modeOptions = document.querySelectorAll('.mode-option');
    const defenseModeInput = document.getElementById('defenseMode');
    modeOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            modeOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            defenseModeInput.value = opt.dataset.value;
        });
    });

    // Attack slider
    const attackSlider = document.getElementById('attackSlider');
    const attackPpsInput = document.getElementById('attackPps');
    const attackDisplay = document.getElementById('attackPpsDisplay');
    const intensityEl = document.getElementById('attackIntensity');
    const intensityMap = [
        { max:0, label:'No Attack', cls:'', color:'#64748b' },
        { max:200, label:'Low', cls:'', color:'#10b981' },
        { max:600, label:'Moderate', cls:'', color:'#f59e0b' },
        { max:1200, label:'High', cls:'', color:'#ef4444' },
        { max:2000, label:'Extreme', cls:'', color:'#ec4899' },
    ];
    if (attackSlider) {
        attackSlider.addEventListener('input', () => {
            const v = parseInt(attackSlider.value);
            attackPpsInput.value = v;
            attackDisplay.textContent = v;
            const level = intensityMap.slice().reverse().find(l => v <= l.max) || intensityMap[intensityMap.length-1];
            intensityEl.textContent = level.label;
            intensityEl.style.background = level.color + '22';
            intensityEl.style.color = level.color;
            intensityEl.style.border = `1px solid ${level.color}44`;
        });
    }

    // Duration slider
    const durationSlider = document.getElementById('durationSlider');
    const durationInput = document.getElementById('duration');
    const durationDisplay = document.getElementById('durationDisplay');
    if (durationSlider) {
        durationSlider.addEventListener('input', () => {
            durationInput.value = durationSlider.value;
            durationDisplay.textContent = durationSlider.value + 's';
        });
    }

    // Topology source toggle
    const srcDefault = document.getElementById('srcDefault');
    const srcWorkspace = document.getElementById('srcWorkspace');
    const wsTopoInfo = document.getElementById('wsTopologyInfo');
    const wsTopoDetails = document.getElementById('wsTopoDetails');
    let useWorkspace = false;

    if (srcDefault && srcWorkspace) {
        srcDefault.addEventListener('click', () => {
            useWorkspace = false;
            srcDefault.classList.add('active');
            srcWorkspace.classList.remove('active');
            if (wsTopoInfo) wsTopoInfo.classList.add('d-none');
        });
        srcWorkspace.addEventListener('click', () => {
            const ws = localStorage.getItem('dtaf_workspace');
            if (ws) {
                const parsed = JSON.parse(ws);
                const nodes = parsed.nodes || [];
                const links = parsed.links || [];
                useWorkspace = true;
                srcWorkspace.classList.add('active');
                srcDefault.classList.remove('active');
                if (wsTopoInfo) {
                    wsTopoInfo.classList.remove('d-none');
                    wsTopoDetails.innerHTML = `<i class="bi bi-diagram-3 me-1 text-primary"></i>${nodes.length} nodes, ${links.length} links loaded`;
                }
            } else {
                alert('No workspace saved. Build a topology in the Workspace tab first.');
            }
        });
    }

    // ===== Network Canvas Visualizer =====
    class NetworkVisualizer {
        constructor(canvasId) {
            this.canvas = document.getElementById(canvasId);
            if (!this.canvas) return;
            this.ctx = this.canvas.getContext('2d');
            this.packets = [];
            this.nodes = {};
            this.animId = null;
            this.customNodes = null;
            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            if (!this.canvas) return;
            const p = this.canvas.parentElement;
            this.canvas.width = p.clientWidth || 800;
            this.canvas.height = this.canvas.offsetHeight || 380;
            this.initNodes();
            this.drawStatic();
        }

        initNodes(customTopology) {
            const w = this.canvas.width, h = this.canvas.height;
            if (customTopology && customTopology.nodes && customTopology.nodes.length > 0) {
                this.customNodes = customTopology.nodes.map((n, i) => {
                    const angle = (i / customTopology.nodes.length) * Math.PI * 2;
                    const cx = w / 2, cy = h / 2;
                    const r = Math.min(w, h) * 0.32;
                    return {
                        id: n.id, type: n.type, label: n.label || n.type,
                        x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r,
                        color: this.nodeColor(n.type)
                    };
                });
                this.customLinks = customTopology.links || [];
            } else {
                this.customNodes = null;
                this.customLinks = null;
                this.nodes = {
                    legit:    { x: w*0.12, y: h*0.28, label:'Legitimate\nUsers', color:'#10b981', icon:'👤' },
                    attacker: { x: w*0.12, y: h*0.72, label:'Malicious\nBotnet', color:'#ef4444', icon:'💀' },
                    router:   { x: w*0.5,  y: h*0.5,  label:'DTAF Router', color:'#6366f1', icon:'📡' },
                    server:   { x: w*0.88, y: h*0.5,  label:'Target\nServer', color:'#0ea5e9', icon:'🖥' }
                };
            }
        }

        nodeColor(type) {
            const map = { router:'#6366f1', switch:'#0ea5e9', server:'#10b981', client:'#94a3b8', attacker:'#ef4444', firewall:'#f59e0b' };
            return map[type] || '#6366f1';
        }

        drawNode(node, label) {
            const ctx = this.ctx;
            // Glow
            const grad = ctx.createRadialGradient(node.x, node.y, 10, node.x, node.y, 55);
            grad.addColorStop(0, node.color + '30');
            grad.addColorStop(1, 'transparent');
            ctx.beginPath(); ctx.arc(node.x, node.y, 55, 0, Math.PI*2);
            ctx.fillStyle = grad; ctx.fill();
            // Circle
            ctx.beginPath(); ctx.arc(node.x, node.y, 30, 0, Math.PI*2);
            ctx.fillStyle = 'rgba(6,11,20,0.9)'; ctx.fill();
            ctx.lineWidth = 2.5; ctx.strokeStyle = node.color; ctx.stroke();
            // Label
            const lines = (label || node.label || '').split('\n');
            ctx.font = '600 11px Space Grotesk, sans-serif';
            ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center';
            lines.forEach((line, i) => ctx.fillText(line, node.x, node.y + 45 + i * 14));
            // Type badge
            ctx.font = 'bold 13px sans-serif';
            ctx.fillStyle = node.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(this.typeEmoji(node.type || ''), node.x, node.y);
            ctx.textBaseline = 'alphabetic';
        }

        typeEmoji(type) {
            const map = { router:'⬡', switch:'◈', server:'▪', client:'●', attacker:'✖', firewall:'◆', legit:'●', attacker2:'✖' };
            return map[type] || '●';
        }

        drawLine(n1, n2, color) {
            this.ctx.beginPath();
            this.ctx.moveTo(n1.x, n1.y);
            this.ctx.lineTo(n2.x, n2.y);
            this.ctx.strokeStyle = color || 'rgba(255,255,255,0.08)';
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([6, 4]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        drawStatic() {
            if (!this.canvas) return;
            const ctx = this.ctx;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            if (this.customNodes) {
                if (this.customLinks) {
                    this.customLinks.forEach(l => {
                        const a = this.customNodes.find(n => n.id === l.source || n.id === l.from);
                        const b = this.customNodes.find(n => n.id === l.target || n.id === l.to);
                        if (a && b) this.drawLine(a, b);
                    });
                }
                this.customNodes.forEach(n => this.drawNode(n));
            } else {
                const n = this.nodes;
                this.drawLine(n.legit, n.router, 'rgba(16,185,129,0.2)');
                this.drawLine(n.attacker, n.router, 'rgba(239,68,68,0.2)');
                this.drawLine(n.router, n.server, 'rgba(99,102,241,0.3)');
                Object.values(n).forEach(node => this.drawNode(node));
            }
        }

        spawnPacket(type, src, dst, willDrop) {
            this.packets.push({ x:src.x, y:src.y, src, dst, type, progress:0, speed:0.018+Math.random()*0.012, willDrop, passed:false });
        }

        spawnCustomPacket(type, srcIdx, willDrop) {
            if (!this.customNodes || this.customNodes.length < 2) return;
            const src = this.customNodes[srcIdx % this.customNodes.length];
            const routerNode = this.customNodes.find(n => n.type === 'router') || this.customNodes[Math.floor(this.customNodes.length/2)];
            const serverNode = this.customNodes.find(n => n.type === 'server') || this.customNodes[this.customNodes.length-1];
            const dst = src === routerNode ? serverNode : routerNode;
            this.packets.push({ x:src.x, y:src.y, src, dst, type, progress:0, speed:0.018+Math.random()*0.012, willDrop, passed:false, customFlow:true, finalDst:serverNode });
        }

        getRouterNode() {
            if (this.customNodes) return this.customNodes.find(n => n.type==='router') || this.customNodes[Math.floor(this.customNodes.length/2)];
            return this.nodes.router;
        }
        getLegitNode() { return this.customNodes ? (this.customNodes.find(n=>n.type==='client')||this.customNodes[0]) : this.nodes.legit; }
        getAttackerNode() { return this.customNodes ? (this.customNodes.find(n=>n.type==='attacker')||this.customNodes[1]||this.customNodes[0]) : this.nodes.attacker; }
        getServerNode() { return this.customNodes ? (this.customNodes.find(n=>n.type==='server')||this.customNodes[this.customNodes.length-1]) : this.nodes.server; }

        render() {
            const ctx = this.ctx;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.drawStatic();
            // Draw packets
            for (let i = this.packets.length - 1; i >= 0; i--) {
                const p = this.packets[i];
                p.progress += p.speed;
                if (p.progress >= 1) {
                    // At destination
                    if (!p.passed && p.dst === this.getRouterNode()) {
                        if (p.willDrop) {
                            // Flash explosion
                            ctx.beginPath(); ctx.arc(p.dst.x+(Math.random()*16-8), p.dst.y+(Math.random()*16-8), 12, 0, Math.PI*2);
                            ctx.fillStyle = (p.type==='attack'?'rgba(239,68,68,0.4)':'rgba(236,72,153,0.3)');
                            ctx.fill();
                            this.packets.splice(i, 1); continue;
                        } else {
                            p.src = p.dst; p.dst = this.getServerNode();
                            p.x = p.src.x; p.y = p.src.y; p.progress = 0; p.passed = true; continue;
                        }
                    }
                    this.packets.splice(i, 1); continue;
                }
                p.x = p.src.x + (p.dst.x - p.src.x) * p.progress;
                p.y = p.src.y + (p.dst.y - p.src.y) * p.progress;
                ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
                const c = p.type==='attack'?'#ef4444':'#10b981';
                ctx.fillStyle = c;
                ctx.shadowBlur = 12; ctx.shadowColor = c;
                ctx.fill(); ctx.shadowBlur = 0;
            }
            this.animId = requestAnimationFrame(() => this.render());
        }

        start() { if (!this.animId) this.render(); }
        stop() { if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; } }
        clear() { this.packets = []; this.drawStatic(); }
    }

    // ===== Run simulation =====
    let chartInstances = [];
    const viz = new NetworkVisualizer('networkCanvas');
    viz.drawStatic();

    simForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('runBtn');
        const liveStats = document.getElementById('liveStats');
        const miniCharts = document.getElementById('miniCharts');
        const simActions = document.getElementById('simActions');

        btn.disabled = true;
        btn.querySelector('.run-btn-text').textContent = 'Simulating…';
        if (liveStats) liveStats.classList.remove('d-none');
        if (miniCharts) miniCharts.classList.add('d-none');
        if (simActions) simActions.classList.add('d-none');

        let topology = null;
        if (useWorkspace) {
            try { topology = JSON.parse(localStorage.getItem('dtaf_workspace') || 'null'); } catch(e){}
        }

        const payload = {
            defense_mode: document.getElementById('defenseMode').value,
            attack_pps: parseInt(document.getElementById('attackPps').value) || 0,
            duration: parseInt(document.getElementById('duration').value) || 60,
            topology
        };

        try {
            const res = await fetch('/api/simulate', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            localStorage.setItem('dtaf_last_sim', JSON.stringify(data));
            const count = parseInt(localStorage.getItem('dtaf_sim_count')||'0') + 1;
            localStorage.setItem('dtaf_sim_count', count);

            // Load topology into viz
            if (topology) viz.initNodes(topology);
            else viz.initNodes(null);

            viz.start();

            // Playback
            const ticks = data.labels.length;
            let tick = 0;
            const sProg = document.getElementById('simProgress');
            const sTime = document.getElementById('simTimeLabel');
            const sDur = document.getElementById('simDurationLabel');
            const sLegit = document.getElementById('statLegitSent');
            const sAtk = document.getElementById('statAttackSent');
            const sRcv = document.getElementById('statReceived');
            const sBlk = document.getElementById('statBlocked');
            const sThru = document.getElementById('statThru');
            const sDly = document.getElementById('statDelay');
            const sLoss = document.getElementById('statLoss');
            if (sDur) sDur.textContent = payload.duration + 's';

            let totLegit=0,totAtk=0,totRcv=0,totBlk=0;
            const interval = setInterval(() => {
                if (tick >= ticks) {
                    clearInterval(interval);
                    viz.stop(); viz.clear();
                    btn.disabled = false;
                    btn.querySelector('.run-btn-text').textContent = 'Launch Simulation';
                    if (miniCharts) { miniCharts.classList.remove('d-none'); renderMiniCharts(data); }
                    if (simActions) simActions.classList.remove('d-none');
                    return;
                }

                totLegit += data.legit_traffic[tick];
                totAtk += data.attack_traffic[tick];
                totRcv += data.legit_passed[tick];
                totBlk += (data.attack_dropped[tick] + data.legit_dropped[tick]);

                if (sProg) sProg.style.width = ((tick/ticks)*100) + '%';
                if (sTime) sTime.textContent = data.labels[tick] + 's';
                if (sLegit) sLegit.textContent = Math.round(totLegit).toLocaleString();
                if (sAtk) sAtk.textContent = Math.round(totAtk).toLocaleString();
                if (sRcv) sRcv.textContent = Math.round(totRcv).toLocaleString();
                if (sBlk) sBlk.textContent = Math.round(totBlk).toLocaleString();
                if (sThru) sThru.textContent = data.throughput[tick] + ' Kbps';
                if (sDly) sDly.textContent = data.delay[tick] + ' ms';
                if (sLoss) sLoss.textContent = data.packet_loss[tick] + '%';

                // Spawn packets
                const rA = data.attack_dropped[tick] / Math.max(1, data.attack_traffic[tick]);
                const rL = data.legit_dropped[tick] / Math.max(1, data.legit_traffic[tick]);
                const vL = Math.ceil(data.legit_traffic[tick] / 80);
                const vA = Math.ceil(data.attack_traffic[tick] / 80);
                const rNode = viz.getRouterNode();
                const lNode = viz.getLegitNode();
                const aNode = viz.getAttackerNode();
                for (let j=0;j<Math.min(vL,8);j++) viz.spawnPacket('legit', lNode, rNode, Math.random()<rL);
                for (let j=0;j<Math.min(vA,8);j++) viz.spawnPacket('attack', aNode, rNode, Math.random()<rA);

                tick++;
            }, 120);

        } catch(err) {
            btn.disabled = false;
            btn.querySelector('.run-btn-text').textContent = 'Launch Simulation';
            if (liveStats) liveStats.classList.add('d-none');
            alert('Simulation error: ' + err.message);
        }
    });

    function renderMiniCharts(data) {
        chartInstances.forEach(c => c.destroy());
        chartInstances = [];

        Chart.defaults.color = '#94a3b8';
        Chart.defaults.font.family = "'Space Grotesk', sans-serif";

        const opts = (yTitle) => ({
            responsive:true, maintainAspectRatio:false,
            interaction:{mode:'index',intersect:false},
            plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'rgba(10,15,30,0.95)', titleColor:'#f8fafc', bodyColor:'#cbd5e1', borderColor:'rgba(99,102,241,0.3)', borderWidth:1 } },
            scales:{
                x:{ ticks:{color:'#64748b',maxTicksLimit:8}, grid:{color:'rgba(255,255,255,0.04)'} },
                y:{ title:{display:true,text:yTitle,color:'#64748b',font:{size:10}}, ticks:{color:'#64748b'}, grid:{color:'rgba(255,255,255,0.04)'}, beginAtZero:true }
            }
        });

        const mkLine = (id, datasets, yTitle) => {
            const el = document.getElementById(id);
            if (!el) return;
            chartInstances.push(new Chart(el, { type:'line', data:{labels:data.labels,datasets}, options:opts(yTitle) }));
        };

        mkLine('trafficChart', [
            {label:'Attack', data:data.attack_traffic, borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)', borderWidth:2, fill:true, tension:0.3, pointRadius:0},
            {label:'Legit', data:data.legit_traffic, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.08)', borderWidth:2, fill:true, tension:0.3, pointRadius:0}
        ], 'pps');

        mkLine('defenseChart', [
            {label:'Atk Dropped', data:data.attack_dropped, borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.1)', borderWidth:2, fill:true, tension:0.3, pointRadius:0},
            {label:'Legit Drop', data:data.legit_dropped, borderColor:'#ec4899', backgroundColor:'rgba(236,72,153,0.1)', borderWidth:2, fill:true, tension:0.3, pointRadius:0}
        ], 'pps');

        mkLine('liveChart', [
            {label:'Throughput', data:data.throughput, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.1)', borderWidth:2, fill:true, tension:0.4, pointRadius:0}
        ], 'Kbps');

        mkLine('delayLiveChart', [
            {label:'Delay', data:data.delay, borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.1)', borderWidth:2, fill:true, tension:0.4, pointRadius:0}
        ], 'ms');
    }
});

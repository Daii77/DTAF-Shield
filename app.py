from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from simulator import run_simulation
import os
import json

app = Flask(__name__)
app.secret_key = 'dtaf_sec404_advanced_workspace_2024'

# File-based workspace storage
WORKSPACES_FILE = 'workspaces.json'

def load_workspaces():
    if os.path.exists(WORKSPACES_FILE):
        try:
            with open(WORKSPACES_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_workspaces(workspaces):
    with open(WORKSPACES_FILE, 'w') as f:
        json.dump(workspaces, f, indent=4)

@app.route('/')
def index():
    if 'logged_in' in session:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if username == 'admin' and password == 'admin':
            session['logged_in'] = True
            session['username'] = username
            return redirect(url_for('dashboard'))
        else:
            return render_template('login.html', error='Invalid Credentials. Try admin/admin')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/dashboard')
def dashboard():
    if 'logged_in' not in session: return redirect(url_for('login'))
    return render_template('dashboard.html')

@app.route('/workspace')
def workspace():
    if 'logged_in' not in session: return redirect(url_for('login'))
    return render_template('workspace.html')

@app.route('/simulation')
def simulation():
    if 'logged_in' not in session: return redirect(url_for('login'))
    return render_template('simulation.html')

@app.route('/results')
def results():
    if 'logged_in' not in session: return redirect(url_for('login'))
    return render_template('results.html')

@app.route('/compare')
def compare():
    if 'logged_in' not in session: return redirect(url_for('login'))
    return render_template('compare.html')

# ===== API Routes =====

@app.route('/api/simulate', methods=['POST'])
def api_simulate():
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    try:
        data = request.json or {}
        defense_mode = str(data.get('defense_mode', 'none'))
        topology = data.get('topology', None)
        
        try:
            attack_pps = int(data.get('attack_pps', 0))
        except (ValueError, TypeError):
            attack_pps = 0
            
        try:
            duration = int(data.get('duration', 60))
        except (ValueError, TypeError):
            duration = 60
            
        attack_pps = max(0, attack_pps)
        duration = max(10, min(300, duration))
        
        sim_results = run_simulation(defense_mode, attack_pps, duration, topology)
        return jsonify(sim_results)
        
    except Exception as e:
        return jsonify({"error": f"Simulation failed: {str(e)}"}), 500

@app.route('/api/simulate_workspace', methods=['POST'])
def api_simulate_workspace():
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    try:
        from simulator import generate_and_run_dynamic_topology
        data = request.json or {}
        defense_mode = str(data.get('defense_mode', 'none'))
        topology = data.get('topology', {})
        
        try:
            attack_pps = int(data.get('attack_pps', 0))
        except (ValueError, TypeError):
            attack_pps = 0
            
        attack_pps = max(0, attack_pps)
        
        sim_results = generate_and_run_dynamic_topology(defense_mode, attack_pps, topology)
        return jsonify(sim_results)
        
    except Exception as e:
        return jsonify({"error": f"Dynamic Simulation failed: {str(e)}"}), 500

@app.route('/api/simulate_compare', methods=['POST'])
def api_simulate_compare():
    """Run all 3 defense modes simultaneously for comparison"""
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    try:
        data = request.json or {}
        topology = data.get('topology', None)
        
        try:
            attack_pps = int(data.get('attack_pps', 1000))
        except (ValueError, TypeError):
            attack_pps = 1000
            
        try:
            duration = int(data.get('duration', 60))
        except (ValueError, TypeError):
            duration = 60
            
        attack_pps = max(1, attack_pps)
        duration = max(10, min(300, duration))
        
        results = {}
        for mode in ['none', 'static', 'dtaf']:
            results[mode] = run_simulation(mode, attack_pps, duration, topology)
        
        return jsonify(results)
        
    except Exception as e:
        return jsonify({"error": f"Comparison failed: {str(e)}"}), 500

@app.route('/api/attack', methods=['POST'])
def api_attack():
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    try:
        from simulator import run_attack_simulation
        data = request.json or {}
        attack_type = str(data.get('attack_type', 'syn_flood'))
        defense_mode = str(data.get('defense_mode', 'none'))
        topology = data.get('topology', None)
        
        try:
            attack_pps = int(data.get('attack_pps', 1000))
        except (ValueError, TypeError):
            attack_pps = 1000
            
        try:
            duration = int(data.get('duration', 60))
        except (ValueError, TypeError):
            duration = 60
            
        attack_pps = max(1, attack_pps)
        duration = max(10, min(300, duration))
        
        sim_results = run_attack_simulation(attack_type, defense_mode, attack_pps, duration, topology)
        return jsonify(sim_results)
        
    except Exception as e:
        return jsonify({"error": f"Attack simulation failed: {str(e)}"}), 500

@app.route('/api/ns2_command', methods=['POST'])
def api_ns2_command():
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    try:
        from simulator import run_ns2_command
        data = request.json or {}
        command = str(data.get('command', ''))
        topology = data.get('topology', {})
        
        result = run_ns2_command(command, topology)
        return jsonify(result)
        
    except Exception as e:
        return jsonify({"error": f"Command failed: {str(e)}"}), 500



@app.route('/api/workspace/save', methods=['POST'])
def save_workspace():
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    try:
        data = request.json or {}
        workspace_id = data.get('id', 'default')
        workspace_name = data.get('name', 'My Workspace')
        topology = data.get('topology', {})
        
        username = session.get('username', 'admin')
        key = f"{username}_{workspace_id}"
        
        workspaces = load_workspaces()
        workspaces[key] = {
            'id': workspace_id,
            'name': workspace_name,
            'topology': topology,
            'created_by': username
        }
        save_workspaces(workspaces)
        
        return jsonify({"success": True, "id": workspace_id, "message": "Workspace saved"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/workspace/load', methods=['GET'])
def load_workspace():
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    username = session.get('username', 'admin')
    user_workspaces = []
    
    workspaces = load_workspaces()
    for key, ws in workspaces.items():
        if ws.get('created_by') == username:
            user_workspaces.append({
                'id': ws['id'],
                'name': ws['name'],
                'node_count': len(ws.get('topology', {}).get('nodes', []))
            })
    
    return jsonify({"workspaces": user_workspaces})

@app.route('/api/workspace/<workspace_id>', methods=['GET'])
def get_workspace(workspace_id):
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    username = session.get('username', 'admin')
    key = f"{username}_{workspace_id}"
    
    workspaces = load_workspaces()
    if key in workspaces:
        ws = workspaces[key]
        if not ws.get('topology') or not isinstance(ws.get('topology'), dict):
            ws['topology'] = {}
        return jsonify(ws)
    
    return jsonify({"error": "Workspace not found"}), 404

@app.route('/api/workspace/<workspace_id>', methods=['DELETE'])
def delete_workspace(workspace_id):
    if 'logged_in' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    username = session.get('username', 'admin')
    key = f"{username}_{workspace_id}"
    
    workspaces = load_workspaces()
    if key in workspaces:
        del workspaces[key]
        save_workspaces(workspaces)
        return jsonify({"success": True})
    
    return jsonify({"error": "Workspace not found"}), 404

if __name__ == '__main__':
    app.run(debug=True, port=5000)
#!/usr/bin/env python3
import csv, os, sys, glob, html, datetime

# ========= EDIT THESE ONCE =========
PROJECT_TITLE = "Dynamic Traffic-Aware Filtering (DTAF): Adaptive Threshold Mechanism for DoS Defense in NS2"

UNIVERSITY = "University of Hail"
COLLEGE    = "College of Computer Science and Engineering"
DEPARTMENT = "Department of Computer Science"
COURSE     = "Graduation Project"
INSTRUCTOR = "Prof/Dr. […………………]"


TEAM = [
    {"name":"Ghala Fahad Alamer",        "id":"202103571",
     "work":[
        "NS2 installation and environment preparation on Ubuntu",
        "Compilation fixes and build verification",
        "Integration validation of Queue/DTAF in NS2 runtime",
        "NAM validation and output file verification"
     ]},
    {"name":"Maha Ali Almuzaini",        "id":"202102138",
     "work":[
        "Topology and scenario design (legitimate + attacker + router + sink)",
        "TCL scripting for parameterized simulation runs",
        "Traffic configuration (CBR/UDP legitimate + flood attack)",
        "Scenario validation across attack levels"
     ]},
    {"name":"Abeer Salman Alshammri",    "id":"202104006",
     "work":[
        "Trace parsing and performance metric extraction",
        "Computation of throughput, delay, loss rate",
        "Parsing DTAF log to estimate false positive rate",
        "Generation of summary.csv for all experiments"
     ]},
    {"name":"Dhai Thwaini Alshammri",    "id":"202101846",
     "work":[
        "Plot generation (PNG) from summary.csv",
        "HTML report automation and integration",
        "Validation of graphs against computed metrics",
        "NAM demo run preparation for documentation"
     ]},
    {"name":"Nada Nasser Alshubily",     "id":"202102965",
     "work":[
        "Academic documentation and report structure",
        "Results interpretation and discussion writing",
        "Figures/tables consistency checks",
        "Limitations and future work section drafting"
     ]},
]
# ===================================

def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))

def html_table(rows):
    if not rows:
        return "<p>No rows found.</p>"
    cols = list(rows[0].keys())
    out = []
    out.append("<table>")
    out.append("<thead><tr>" + "".join(f"<th>{html.escape(c)}</th>" for c in cols) + "</tr></thead>")
    out.append("<tbody>")
    for r in rows:
        out.append("<tr>" + "".join(f"<td>{html.escape(str(r[c]))}</td>" for c in cols) + "</tr>")
    out.append("</tbody></table>")
    return "\n".join(out)

def list_files(pattern, title):
    files = sorted(glob.glob(pattern))
    if not files:
        return f"<h3>{title}</h3><p>None.</p>"
    items = "\n".join(
        f'<li><a href="{html.escape(os.path.basename(p))}">{html.escape(os.path.basename(p))}</a></li>'
        for p in files
    )
    return f"<h3>{title}</h3><ul>{items}</ul>"

def team_section():
    out = []
    out.append("<h2>Team Members & Contributions</h2>")
    out.append("<table>")
    out.append("<thead><tr><th>Name</th><th>ID</th><th>Main Contributions</th></tr></thead><tbody>")
    for m in TEAM:
        bullets = "<ul>" + "".join(f"<li>{html.escape(x)}</li>" for x in m["work"]) + "</ul>"
        out.append(
            "<tr>"
            f"<td>{html.escape(m['name'])}</td>"
            f"<td>{html.escape(m['id'])}</td>"
            f"<td style='text-align:left'>{bullets}</td>"
            "</tr>"
        )
    out.append("</tbody></table>")
    return "\n".join(out)

def print_console_summary(rows):
    print("\n=== Project Info ===")
    print("Title:", PROJECT_TITLE)
    print("University:", UNIVERSITY)
    print("College:", COLLEGE)
    print("Department:", DEPARTMENT)
    print("Course:", COURSE)
    print("Instructor:", INSTRUCTOR)
    print("\n=== Team ===")
    for m in TEAM:
        print(f"- {m['name']} ({m['id']})")
    print("\n=== Results (summary.csv) ===")
    for r in rows:
        print(f"{r['scenario']:>8} | {r['defense']:<6} | thr={r['throughput_kbps']} Kbps | delay={r['avg_delay_ms']} ms | loss={r['loss_rate_pct']}% | fp={r['fp_rate_pct']}%")

def main():
    # expected run from ns-2.35 directory
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "dtaf_project/results/summary.csv"
    out_html = sys.argv[2] if len(sys.argv) > 2 else "dtaf_project/results/report.html"

    rows = read_csv(csv_path)
    print_console_summary(rows)

    css = """
    body { font-family: Arial, sans-serif; margin: 24px; }
    h1 { margin-bottom: 6px; }
    .meta { margin-top: 0; color:#333; }
    .small { color:#444; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0 18px; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: center; vertical-align: top; }
    th { background: #f2f2f2; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { border: 1px solid #ddd; padding: 12px; border-radius: 8px; }
    img { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 6px; }
    code { background:#f7f7f7; padding:2px 4px; border-radius:4px; }
    ul { margin: 6px 0 6px 18px; }
    """
    imgs = [
        ("throughput.png", "Throughput vs Attack Level"),
        ("delay.png", "Average Delay vs Attack Level"),
        ("loss.png", "Packet Loss vs Attack Level"),
        ("fp.png", "False Positive Rate vs Attack Level"),
    ]

    parts = []
    parts.append("<!doctype html><html><head><meta charset='utf-8'>")
    parts.append("<title>DTAF Results Report</title>")
    parts.append(f"<style>{css}</style></head><body>")

    # Cover/Meta
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    parts.append(f"<h1>{html.escape(PROJECT_TITLE)}</h1>")
    parts.append("<p class='meta'>"
                 f"<b>University:</b> {html.escape(UNIVERSITY)} &nbsp;|&nbsp; "
                 f"<b>College:</b> {html.escape(COLLEGE)} &nbsp;|&nbsp; "
                 f"<b>Department:</b> {html.escape(DEPARTMENT)}<br>"
                 f"<b>Course:</b> {html.escape(COURSE)} &nbsp;|&nbsp; "
                 f"<b>Instructor:</b> {html.escape(INSTRUCTOR)} &nbsp;|&nbsp; "
                 f"<b>Generated:</b> {html.escape(now)}"
                 "</p>")

    parts.append(team_section())

    parts.append("<h2>Summary Results (summary.csv)</h2>")
    parts.append("<p class='small'>Metrics include throughput, average delay, packet loss, and false positive rate.</p>")
    parts.append(html_table(rows))

    parts.append("<h2>Graphs</h2>")
    parts.append("<div class='grid'>")
    for fn, cap in imgs:
        parts.append("<div class='card'>")
        parts.append(f"<h3>{html.escape(cap)}</h3>")
        if os.path.exists(os.path.join(os.path.dirname(out_html), fn)):
            parts.append(f"<img src='{html.escape(fn)}' alt='{html.escape(cap)}'>")
        else:
            parts.append(f"<p>Missing: {html.escape(fn)} (run plot script)</p>")
        parts.append("</div>")
    parts.append("</div>")

    # File lists (results directory)
    results_dir = os.path.dirname(out_html) or "."
    cwd = os.getcwd()
    os.chdir(results_dir)
    parts.append("<h2>Output Files</h2>")
    parts.append(list_files("*.tr", "Trace files (.tr)"))
    parts.append(list_files("*.dtaf.log", "DTAF logs (.dtaf.log)"))
    parts.append(list_files("*.nam", "NAM files (.nam)"))
    parts.append(list_files("*.png", "Figures (.png)"))
    parts.append(list_files("*.csv", "CSV files (.csv)"))
    os.chdir(cwd)

    parts.append("<h2>How to View</h2>")
    parts.append("<ul>")
    parts.append("<li>Open <code>report.html</code> in a web browser.</li>")
    parts.append("<li>Open NAM animation: <code>nam file.nam</code></li>")
    parts.append("</ul>")

    parts.append("</body></html>")

    os.makedirs(os.path.dirname(out_html), exist_ok=True)
    with open(out_html, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))

    print("\nWrote HTML report:", out_html)

if __name__ == "__main__":
    main()

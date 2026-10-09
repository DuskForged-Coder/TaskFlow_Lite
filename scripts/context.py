#!/usr/bin/env python3
"""Manage .dev/context.md — stdlib only."""
import argparse
import datetime
import os
import re
import sys

CONTEXT_PATH = os.path.join(".dev", "context.md")
SECTIONS = [
    "meta",
    "handoff",
    "project",
    "stack",
    "capabilities",
    "plan",
    "decisions",
    "changelog",
    "blockers",
]

TITLES = {
    "meta": "Meta",
    "handoff": "Handoff",
    "project": "Project",
    "stack": "Stack",
    "capabilities": "Capabilities",
    "plan": "Plan",
    "decisions": "Decisions",
    "changelog": "Changelog",
    "blockers": "Blockers",
}

ANCHOR_RE = re.compile(r"<!--\s*SECTION:\s*(\S+)\s*-->")


def template_text():
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    lines = []
    lines.append("<!-- SECTION: meta -->")
    lines.append("## Meta")
    lines.append("- status: in_progress")
    lines.append("- gate: none")
    lines.append("- active_phase: none")
    lines.append("- scope_budget: unset")
    lines.append("- updated: " + now)
    lines.append("")
    lines.append("<!-- SECTION: handoff -->")
    lines.append("## Handoff")
    lines.append("- last_flush: " + now)
    lines.append("- active_phase: none")
    lines.append("- intent: bootstrapped")
    lines.append("- decisions: none")
    lines.append("- questions: none")
    lines.append("- settled: none")
    lines.append("")
    lines.append("<!-- SECTION: project -->")
    lines.append("## Project")
    lines.append("(empty — fill in Phase 1)")
    lines.append("")
    lines.append("<!-- SECTION: stack -->")
    lines.append("## Stack")
    lines.append("(empty — fill in Phase 2)")
    lines.append("")
    lines.append("<!-- SECTION: capabilities -->")
    lines.append("## Capabilities")
    lines.append("(empty — fill in Phase 3)")
    lines.append("")
    lines.append("<!-- SECTION: plan -->")
    lines.append("## Plan")
    lines.append("(empty — fill in Phase 4)")
    lines.append("")
    lines.append("<!-- SECTION: decisions -->")
    lines.append("## Decisions")
    lines.append("(none yet)")
    lines.append("<!-- SECTION: changelog -->")
    lines.append("## Changelog")
    lines.append("- bootstrapped context")
    lines.append("")
    lines.append("<!-- SECTION: blockers -->")
    lines.append("## Blockers")
    lines.append("(none)")
    lines.append("")
    return "\n".join(lines)


def split_sections(text):
    parts = ANCHOR_RE.split(text)
    # parts[0] is preamble, then name/body pairs
    out = {}
    order = []
    i = 1
    while i < len(parts):
        name = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        out[name] = body
        order.append(name)
        i += 2
    return out, order


def load():
    if not os.path.exists(CONTEXT_PATH):
        print("FAIL: missing " + CONTEXT_PATH, file=sys.stderr)
        sys.exit(1)
    with open(CONTEXT_PATH, encoding="utf-8") as f:
        text = f.read()
    return text


def parse_meta(body):
    keys = []
    vals = {}
    for line in body.splitlines():
        m = re.match(r"\s*-\s*([^:]+):\s*(.*)", line)
        if m:
            raw = m.group(1).strip()
            norm = re.sub(r"\s+", "_", raw.lower())
            val = m.group(2).strip()
            keys.append((raw, norm))
            vals[norm] = val
    return keys, vals


def render_section(name, body):
    body = body.rstrip("\n") + "\n"
    return "<!-- SECTION: " + name + " -->\n## " + TITLES[name] + "\n" + body


def save_sections(sections, order):
    chunks = []
    for name in order:
        chunks.append(render_section(name, sections[name]))
    with open(CONTEXT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(chunks))


def cmd_init(args):
    if os.path.exists(CONTEXT_PATH) and not args.force:
        print("refusing: exists (use --force)", file=sys.stderr)
        sys.exit(1)
    os.makedirs(os.path.dirname(CONTEXT_PATH), exist_ok=True)
    with open(CONTEXT_PATH, "w", encoding="utf-8") as f:
        f.write(template_text())
    print("wrote " + CONTEXT_PATH)


def cmd_read(args):
    text = load()
    sections, _ = split_sections(text)
    name = args.section or "meta"
    if name not in sections:
        print("FAIL: unknown section " + name, file=sys.stderr)
        sys.exit(1)
    print(sections[name].strip())


def cmd_update(args):
    text = load()
    sections, order = split_sections(text)
    if args.section not in sections:
        print("FAIL: unknown section " + args.section, file=sys.stderr)
        sys.exit(1)
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            new_body = f.read()
    else:
        new_body = sys.stdin.read()
    sections[args.section] = new_body
    save_sections(sections, order)
    print("updated " + args.section)


def cmd_flush(args):
    text = load()
    sections, order = split_sections(text)
    _, meta = parse_meta(sections.get("meta", ""))
    active = meta.get("active_phase", "none")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    body = "## Handoff\n"
    body += "- last_flush: " + now + "\n"
    body += "- active_phase: " + active + "\n"
    body += "- intent: " + (args.intent or "none") + "\n"
    body += "- decisions: " + (args.decisions or "none") + "\n"
    body += "- questions: " + (args.questions or "none") + "\n"
    body += "- settled: " + (args.settled or "none") + "\n"
    sections["handoff"] = body
    save_sections(sections, order)
    print("flushed")
def cmd_gate_open(args):
    text = load()
    sections, order = split_sections(text)
    keys, meta = parse_meta(sections.get("meta", ""))
    meta["status"] = "awaiting_user"
    meta["gate"] = args.name
    lines = ["## Meta"]
    seen = set()
    for raw, norm in keys:
        seen.add(norm)
        lines.append("- " + raw + ": " + meta.get(norm, ""))
    for norm in meta:
        if norm not in seen:
            lines.append("- " + norm + ": " + meta[norm])
    sections["meta"] = "\n".join(lines) + "\n"
    save_sections(sections, order)
    print("opened " + args.name)


def cmd_gate_check(args):
    expected = args.token if args.token else "approve " + args.name
    msg = args.message or ""
    if expected.lower() in msg.lower():
        print("ok")
        sys.exit(0)
    print("denied: expected token '" + expected + "'", file=sys.stderr)
    sys.exit(1)


def cmd_gate_close(args):
    text = load()
    sections, order = split_sections(text)
    keys, meta = parse_meta(sections.get("meta", ""))
    current = meta.get("gate", "none")
    if current not in ("none", "", args.name):
        print("FAIL: gate " + current + " is open", file=sys.stderr)
        sys.exit(1)
    meta["status"] = "in_progress"
    meta["gate"] = "none"
    lines = ["## Meta"]
    seen = set()
    for raw, norm in keys:
        seen.add(norm)
        lines.append("- " + raw + ": " + meta.get(norm, ""))
    for norm in meta:
        if norm not in seen:
            lines.append("- " + norm + ": " + meta[norm])
    sections["meta"] = "\n".join(lines) + "\n"
    save_sections(sections, order)
    print("closed " + args.name)


def cmd_check(args):
    text = load()
    sections, _ = split_sections(text)
    fails = []
    _, meta = parse_meta(sections.get("meta", ""))
    active = meta.get("active_phase", "none")
    plan = sections.get("plan", "")
    if active and active not in ("none", "") and active not in plan:
        fails.append("FAIL: active_phase '" + active + "' not in plan")
    status = meta.get("status", "")
    gate = meta.get("gate", "none")
    if status == "awaiting_user" and (not gate or gate == "none"):
        fails.append("FAIL: awaiting_user with no open gate")
    if fails:
        for f in fails:
            print(f, file=sys.stderr)
        sys.exit(1)
    print("ok")


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("init")
    a.add_argument("--force", action="store_true")
    a.set_defaults(fn=cmd_init)
    a = sub.add_parser("read")
    a.add_argument("--section", default=None)
    a.set_defaults(fn=cmd_read)
    a = sub.add_parser("update")
    a.add_argument("section")
    a.add_argument("--file", default=None)
    a.set_defaults(fn=cmd_update)
    a = sub.add_parser("flush")
    a.add_argument("--intent", default=None)
    a.add_argument("--decisions", default=None)
    a.add_argument("--questions", default=None)
    a.add_argument("--settled", default=None)
    a.set_defaults(fn=cmd_flush)
    a = sub.add_parser("gate")
    g = a.add_subparsers(dest="gcmd", required=True)
    b = g.add_parser("open")
    b.add_argument("--name", required=True)
    b.set_defaults(fn=cmd_gate_open)
    b = g.add_parser("check")
    b.add_argument("--name", required=True)
    b.add_argument("--message", default=None)
    b.add_argument("--token", default=None)
    b.set_defaults(fn=cmd_gate_check)
    b = g.add_parser("close")
    b.add_argument("--name", required=True)
    b.set_defaults(fn=cmd_gate_close)
    a = sub.add_parser("check")
    a.set_defaults(fn=cmd_check)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

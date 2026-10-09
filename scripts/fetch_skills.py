#!/usr/bin/env python3
"""Resolve capabilities to skills — stdlib only."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

REGISTRY = os.path.join(".agents", "registry.json")
SKILLS_DIR = os.path.join(".agents", "skills")
SOURCES_DIR = os.path.join(SKILLS_DIR, "_sources")
QUAR_DIR = os.path.join(SKILLS_DIR, "_quarantine")
INDEX = os.path.join(SKILLS_DIR, "INDEX.md")
VET = os.path.join("scripts", "vet_skill.sh")

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv"}


def load_registry():
    with open(REGISTRY, encoding="utf-8") as f:
        return json.load(f)


def parse_frontmatter(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    m = re.search(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip().strip("'\"")
    return out


def find_skills(dest):
    found = []
    for root, dirs, files in os.walk(dest):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        if "SKILL.md" in files:
            found.append(root)
    return found


def clone(source):
    dest = os.path.join(SOURCES_DIR, source["id"])
    if os.path.exists(dest):
        return dest, False
    os.makedirs(SOURCES_DIR, exist_ok=True)
    cmd = ["git", "clone", "--depth", "1", "--branch",
           source["ref"], source["repo"], dest]
    subprocess.run(cmd, check=True)
    return dest, True

def vet(skill_dir):
    try:
        r = subprocess.run(["bash", VET, skill_dir],
                           capture_output=True, text=True)
        return (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return "WARNING: vet failed: " + str(e)


def do_resolve(caps):
    reg = load_registry()
    sources = sorted(reg["sources"], key=lambda s: s["priority"])
    wanted = [c.strip().lower() for c in caps.split(",") if c.strip()]
    matched = {}
    active = []
    for src in sources:
        if all(c in matched for c in wanted):
            break
        try:
            dest, _ = clone(src)
        except subprocess.CalledProcessError as e:
            print("clone failed for " + src["id"] + ": " + str(e),
                  file=sys.stderr)
            continue
        for sdir in find_skills(dest):
            fm = parse_frontmatter(os.path.join(sdir, "SKILL.md"))
            name = fm.get("name", os.path.basename(sdir))
            hay = (name + " " + fm.get("description", "")).lower()
            hits = [c for c in wanted if c not in matched and c in hay]
            if not hits:
                continue
            out = vet(sdir)
            target = os.path.join(SKILLS_DIR, name)
            if "WARNING:" in out:
                q = os.path.join(QUAR_DIR, name)
                if os.path.exists(q):
                    shutil.rmtree(q)
                os.makedirs(QUAR_DIR, exist_ok=True)
                shutil.copytree(sdir, q)
                print("quarantined " + name)
                continue
            if os.path.exists(target):
                shutil.rmtree(target)
            shutil.copytree(sdir, target)
            for c in hits:
                matched[c] = name
            active.append((name, target, src["priority"], hits))
    unresolved = [c for c in wanted if c not in matched]
    write_index(active, sources, unresolved)
    print("active: " + str(len(active)))
    print("unresolved: " + (", ".join(unresolved) if unresolved else "none"))
    print("index: " + INDEX)


def write_index(active, sources, unresolved):
    os.makedirs(SKILLS_DIR, exist_ok=True)
    lines = ["# Skills Index", "", "## Active", "",
             "| Skill | Path | Priority | Matched capabilities |",
             "|---|---|---|---|"]
    for name, path, pri, hits in active:
        lines.append("| " + name + " | " + path + " | " + str(pri)
                     + " | " + ", ".join(hits) + " |")
    if not active:
        lines.append("| (none) | — | — | — |")
    lines += ["", "## Sources", "", "| Repo | Priority | Local path |",
              "|---|---|---|"]
    for s in sorted(sources, key=lambda x: x["priority"]):
        local = os.path.join(SOURCES_DIR, s["id"])
        lines.append("| " + s["repo"] + " | " + str(s["priority"])
                     + " | " + local + " |")
    lines += ["", "## Unresolved", ""]
    if unresolved:
        for c in unresolved:
            lines.append("- " + c)
    else:
        lines.append("- none")
    lines.append("")

def do_fetch_all():
    reg = load_registry()
    for src in sorted(reg["sources"], key=lambda s: s["priority"]):
        try:
            dest, fresh = clone(src)
            print(("cloned " if fresh else "exists ") + src["id"])
        except subprocess.CalledProcessError as e:
            print("clone failed for " + src["id"] + ": " + str(e),
                  file=sys.stderr)


def do_list():
    reg = load_registry()
    for src in sorted(reg["sources"], key=lambda s: s["priority"]):
        dest = os.path.join(SOURCES_DIR, src["id"])
        state = "cloned" if os.path.exists(dest) else "not cloned"
        print(str(src["priority"]) + ". " + src["id"] + " "
              + state + " " + src["repo"])


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("resolve")
    a.add_argument("--capabilities", required=True)
    a.set_defaults(fn=lambda x: do_resolve(x.capabilities))
    a = sub.add_parser("fetch-all")
    a.set_defaults(fn=lambda x: do_fetch_all())
    a = sub.add_parser("list")
    a.set_defaults(fn=lambda x: do_list())
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

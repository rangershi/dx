#!/usr/bin/env python3

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path


def _is_plain_object(value):
    return isinstance(value, dict)


def deep_merge_in_place(target, source):
    if not _is_plain_object(target) or not _is_plain_object(source):
        raise TypeError("deep_merge_in_place expects dicts")

    for key, s_val in source.items():
        if _is_plain_object(s_val):
            t_val = target.get(key)
            if not _is_plain_object(t_val):
                t_val = {}
                target[key] = t_val
            deep_merge_in_place(t_val, s_val)
        else:
            target[key] = s_val

    return target


def load_json_file(path):
    raw = path.read_text(encoding="utf-8")
    return json.loads(raw)


def atomic_write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    serialized = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp_path.write_text(serialized, encoding="utf-8")
    os.replace(tmp_path, path)


def backup_file(path):
    if not path.exists():
        return None
    ts = time.strftime("%Y%m%d%H%M%S")
    bak = path.with_name(f"{path.name}.bak.{ts}")
    shutil.copy2(path, bak)
    return bak


def attach(source_path, target_path, *, make_backup=True, dry_run=False):
    source = load_json_file(source_path)
    if not _is_plain_object(source):
        raise ValueError(f"Source JSON root must be an object: {source_path}")

    if target_path.exists():
        target = load_json_file(target_path)
        if not _is_plain_object(target):
            raise ValueError(f"Target JSON root must be an object: {target_path}")
    else:
        target = {}

    merged = deep_merge_in_place(target, source)

    bak = None
    if make_backup and target_path.exists() and not dry_run:
        bak = backup_file(target_path)

    if not dry_run:
        atomic_write_json(target_path, merged)

    return bak


def main(argv):
    parser = argparse.ArgumentParser(
        description=(
            "Attach JSON fragments into OpenCode global config files. "
            "Rule: deep-merge objects; replace arrays/primitives; preserve other keys."
        )
    )
    parser.add_argument(
        "--oh-source",
        default=str(Path(__file__).resolve().parents[1] / "commands" / "oh_attach.json"),
        help="Path to oh_attach.json",
    )
    parser.add_argument(
        "--opencode-source",
        default=str(Path(__file__).resolve().parents[1] / "commands" / "opencode_attach.json"),
        help="Path to opencode_attach.json",
    )
    parser.add_argument(
        "--config-dir",
        default=str(Path.home() / ".config" / "opencode"),
        help="Config directory (default: ~/.config/opencode)",
    )
    parser.add_argument("--no-backup", action="store_true", help="Do not create .bak files")
    parser.add_argument("--dry-run", action="store_true", help="Do not write files")

    args = parser.parse_args(argv)

    config_dir = Path(os.path.expanduser(args.config_dir)).resolve()
    oh_target = config_dir / "oh-my-opencode.json"
    opencode_target = config_dir / "opencode.json"

    oh_source = Path(args.oh_source).resolve()
    opencode_source = Path(args.opencode_source).resolve()

    if not oh_source.exists():
        raise FileNotFoundError(f"Missing source file: {oh_source}")
    if not opencode_source.exists():
        raise FileNotFoundError(f"Missing source file: {opencode_source}")

    make_backup = not args.no_backup
    dry_run = args.dry_run

    bak1 = attach(oh_source, oh_target, make_backup=make_backup, dry_run=dry_run)
    bak2 = attach(opencode_source, opencode_target, make_backup=make_backup, dry_run=dry_run)

    if dry_run:
        print("DRY_RUN: no files written")
        return 0

    if bak1:
        print(f"backup: {bak1}")
    if bak2:
        print(f"backup: {bak2}")
    print(f"updated: {oh_target}")
    print(f"updated: {opencode_target}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Reapply the local Qwen3-TTS budget patch after oMLX app updates.

Usage:
  python3 scripts/reapply_omlx_qwen3_budget_patch.py
  python3 scripts/reapply_omlx_qwen3_budget_patch.py --multiplier 16 --restart
"""

from __future__ import annotations

import argparse
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path


DEFAULT_TARGET = Path(
    "/Applications/oMLX.app/Contents/Python/framework-mlx-framework/"
    "lib/python3.11/site-packages/mlx_audio/tts/models/qwen3_tts/qwen3_tts.py"
)
DEFAULT_MULTIPLIER = 16
DEFAULT_PORT = 4321


def replace_or_insert_constant(text: str, multiplier: int) -> str:
    constant_pattern = re.compile(r"TEXT_TOKEN_BUDGET_MULTIPLIER\s*=\s*\d+")

    if constant_pattern.search(text):
        return constant_pattern.sub(
            f"TEXT_TOKEN_BUDGET_MULTIPLIER = {multiplier}", text, count=1
        )

    anchor = (
        'def format_duration(seconds: float) -> str:\n'
        '    """Format duration as HH:MM:SS.mmm."""\n'
        "    hours = int(seconds // 3600)\n"
        "    minutes = int((seconds % 3600) // 60)\n"
        "    secs = seconds % 60\n"
        '    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"\n'
    )
    replacement = (
        anchor
        + "\n"
        + f"TEXT_TOKEN_BUDGET_MULTIPLIER = {multiplier}\n"
    )

    if anchor not in text:
        raise RuntimeError("Could not find format_duration() anchor in qwen3_tts.py")

    return text.replace(anchor, replacement, 1)


def replace_generation_budget(text: str) -> str:
    block_pattern = re.compile(
        r"(?P<indent>\s*)# Cap max_tokens based on target text length to prevent runaway generation\n"
        r"(?P=indent)# when .*?\n"
        r"(?P=indent)# At 12\.5 Hz codec rate, ~3-5 codec tokens per text token is typical speech\.\n"
        r"(?P=indent)# .*?\n"
        r"(?P=indent)target_token_count = len\(self\.tokenizer\.encode\(text\)\)\n"
        r"(?P=indent)effective_max_tokens = min\(\n"
        r"(?P=indent)\s*max_tokens,\n"
        r"(?P=indent)\s*max\(75, target_token_count \* TEXT_TOKEN_BUDGET_MULTIPLIER\),\n"
        r"(?P=indent)\s*\)",
        flags=re.MULTILINE | re.DOTALL,
    )

    if len(block_pattern.findall(text)) == 2:
        return text

    legacy_pattern = re.compile(
        r"(?P<indent>\s*)# Cap max_tokens based on target text length to prevent runaway generation\n"
        r"(?P=indent)# when .*?\n"
        r"(?P=indent)# At 12\.5 Hz codec rate, ~3-5 codec tokens per text token is typical speech\.\n"
        r"(?P=indent)# .*?\n"
        r"(?P=indent)target_token_count = len\(self\.tokenizer\.encode\(text\)\)\n"
        r"(?P=indent)effective_max_tokens = min\(max_tokens, max\(75, target_token_count \* 6\)\)",
        flags=re.MULTILINE | re.DOTALL,
    )

    replacement = (
        "{indent}# Cap max_tokens based on target text length to prevent runaway generation\n"
        "{indent}# when {when_line}\n"
        "{indent}# At 12.5 Hz codec rate, ~3-5 codec tokens per text token is typical speech.\n"
        "{indent}# Use a wider multiplier so slower emotional styles have enough room.\n"
        "{indent}target_token_count = len(self.tokenizer.encode(text))\n"
        "{indent}effective_max_tokens = min(\n"
        "{indent}    max_tokens,\n"
        "{indent}    max(75, target_token_count * TEXT_TOKEN_BUDGET_MULTIPLIER),\n"
        "{indent})"
    )

    def repl(match: re.Match[str]) -> str:
        indent = match.group("indent")
        when_lines = [line.strip().removeprefix("# ").strip() for line in match.group(0).splitlines()[1:2]]
        when_line = when_lines[0] if when_lines else "EOS logit doesn't become dominant."
        return replacement.format(indent=indent, when_line=when_line)

    updated, count = legacy_pattern.subn(repl, text)
    if count == 2:
        return updated

    direct_pattern = re.compile(
        r"target_token_count = len\(self\.tokenizer\.encode\(text\)\)\n"
        r"(\s*)effective_max_tokens = min\([^\n]*target_token_count \* 6\)\)",
        flags=re.MULTILINE,
    )
    updated, count = direct_pattern.subn(
        "target_token_count = len(self.tokenizer.encode(text))\n"
        "\\1effective_max_tokens = min(\n"
        "\\1    max_tokens,\n"
        "\\1    max(75, target_token_count * TEXT_TOKEN_BUDGET_MULTIPLIER),\n"
        "\\1)",
        text,
    )
    if count == 2:
        return updated

    raise RuntimeError("Could not rewrite both effective_max_tokens blocks in qwen3_tts.py")


def patch_file(target: Path, multiplier: int) -> bool:
    original = target.read_text()
    updated = replace_or_insert_constant(original, multiplier)
    updated = replace_generation_budget(updated)

    changed = updated != original
    if changed:
        target.write_text(updated)
    return changed


def validate_python_file(target: Path) -> None:
    subprocess.run([sys.executable, "-m", "py_compile", str(target)], check=True)


def find_server_pids(port: int) -> list[int]:
    result = subprocess.run(
        ["lsof", "-ti", f":{port}", "-sTCP:LISTEN"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return []
    return [int(line.strip()) for line in result.stdout.splitlines() if line.strip()]


def wait_for_port(port: int, timeout_seconds: int = 20) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if find_server_pids(port):
            return True
        time.sleep(1)
    return False


def restart_omlx(port: int) -> None:
    pids = find_server_pids(port)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass

    time.sleep(2)
    subprocess.run(["open", "-a", "oMLX"], check=True)

    if not wait_for_port(port):
        raise RuntimeError(f"oMLX did not come back on 127.0.0.1:{port} in time")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reapply the local Qwen3-TTS length-budget patch inside oMLX.app."
    )
    parser.add_argument(
        "--target",
        type=Path,
        default=DEFAULT_TARGET,
        help=f"Path to qwen3_tts.py (default: {DEFAULT_TARGET})",
    )
    parser.add_argument(
        "--multiplier",
        type=int,
        default=DEFAULT_MULTIPLIER,
        help=f"Desired TEXT_TOKEN_BUDGET_MULTIPLIER (default: {DEFAULT_MULTIPLIER})",
    )
    parser.add_argument(
        "--restart",
        action="store_true",
        help="Restart oMLX after patching so the change takes effect immediately.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"oMLX local server port used for restart checks (default: {DEFAULT_PORT})",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target = args.target.expanduser().resolve()

    if not target.exists():
        print(f"Target file not found: {target}", file=sys.stderr)
        return 1

    changed = patch_file(target, args.multiplier)
    validate_python_file(target)

    if args.restart:
        restart_omlx(args.port)

    if changed:
        print(f"Patched {target}")
    else:
        print(f"Already patched: {target}")

    print(f"TEXT_TOKEN_BUDGET_MULTIPLIER={args.multiplier}")
    if args.restart:
        print(f"oMLX restarted on 127.0.0.1:{args.port}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

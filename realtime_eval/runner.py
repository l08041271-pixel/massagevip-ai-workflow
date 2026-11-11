"""Run the checked-in Realtime evaluation dataset or a JSONL trace export.

Usage:
    python -m realtime_eval.runner
    python -m realtime_eval.runner path/to/traces.jsonl
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from realtime_eval.evaluator import evaluate_trace


DEFAULT_DATASET = Path(__file__).with_name("scenarios.jsonl")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: each row must be a JSON object")
        rows.append(value)
    return rows


def run(path: Path = DEFAULT_DATASET) -> int:
    traces = load_jsonl(path)
    if not traces:
        print("No evaluation cases found.")
        return 2

    results = []
    for trace in traces:
        try:
            results.append(evaluate_trace(trace))
        except ValueError as exc:
            results.append({"session_id": trace.get("session_id", "unknown"), "passed": False, "error": str(exc)})

    passed = sum(1 for result in results if result.get("passed"))
    print(json.dumps({
        "dataset": str(path),
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "results": results,
    }, ensure_ascii=False, indent=2))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    dataset = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DATASET
    raise SystemExit(run(dataset))

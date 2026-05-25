"""Audit generated dependency graph data for conservative edge quality."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DEPENDENCY_DIR = PROJECT_ROOT / "data" / "frontend" / "dependency"
DEFAULT_OUTPUT = PROJECT_ROOT / "tmp" / "dependency_graph_audit.json"
DEFAULT_BUNDLE_CHAPTER = "chapter2"
OPERATOR_SYMBOLS = {
    "E",
    "P",
    "Pr",
    "Var",
    "Cov",
    "\\Pr",
    "\\Var",
    "\\Cov",
    "\\E",
    "\\ln",
    "\\log",
    "\\exp",
    "\\sum",
    "\\prod",
    "\\int",
}
DEFAULT_REVIEW_LIMIT = 24
CHAPTER_REVIEW_IDS = {
    "chapter2": [
        "formula_2.7",
        "formula_2.12",
        "formula_2.30a",
        "formula_2.30b",
        "formula_2.46",
        "formula_2.47a",
        "formula_2.47b",
    ],
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def iter_dependency_files(dependency_dir: Path) -> list[Path]:
    return sorted(dependency_dir.glob("*_dependencies.json"), key=lambda path: path.name)


def audit_chapter(path: Path) -> dict[str, Any]:
    payload = read_json(path)
    formulas = payload.get("formulas") or []
    dependencies = payload.get("dependencies") or []
    prerequisites = [prereq for dep in dependencies for prereq in dep.get("prerequisites") or []]
    symbol_fields = []
    for formula in formulas:
        symbol_fields.extend(formula.get("symbols_used") or [])
        symbol_fields.extend(formula.get("symbols_defined") or [])
    for prereq in prerequisites:
        symbol_fields.extend(
            value
            for value in (prereq.get("via_symbol"), prereq.get("symbol"), prereq.get("canonical_symbol"))
            if value
        )

    edge_status_counts = Counter(str(prereq.get("edge_status") or "legacy") for prereq in prerequisites)
    edge_evidence_counts = Counter(str(prereq.get("edge_evidence") or "legacy") for prereq in prerequisites)
    family_in_prereqs = [
        {
            "dependent_id": dep.get("dependent_id"),
            "target_id": prereq.get("target_id"),
            "via_symbol": prereq.get("via_symbol"),
            "edge_status": prereq.get("edge_status"),
        }
        for dep in dependencies
        for prereq in dep.get("prerequisites") or []
        if prereq.get("edge_evidence") == "family_candidate"
    ]
    nonaccepted_in_prereqs = [
        {
            "dependent_id": dep.get("dependent_id"),
            "target_id": prereq.get("target_id"),
            "via_symbol": prereq.get("via_symbol") or prereq.get("symbol"),
            "edge_status": prereq.get("edge_status"),
            "edge_evidence": prereq.get("edge_evidence"),
        }
        for dep in dependencies
        for prereq in dep.get("prerequisites") or []
        if prereq.get("edge_status") not in (None, "accepted")
    ]
    operator_pollution = sorted({symbol for symbol in symbol_fields if symbol in OPERATOR_SYMBOLS})
    fallback_definitions = [
        {
            "dependent_id": dep.get("dependent_id"),
            "symbol": prereq.get("symbol") or prereq.get("via_symbol"),
            "definition": prereq.get("definition"),
            "review_note": prereq.get("review_note"),
        }
        for dep in dependencies
        for prereq in dep.get("prerequisites") or []
        if prereq.get("type") == "variable_definition"
        and (
            "Contextual symbol" in str(prereq.get("definition") or "")
            or prereq.get("review_note") in {"local_context", "text_excerpt", "missing_text_definition"}
        )
    ]

    return {
        "chapter_id": payload.get("chapter_id"),
        "formula_count": len(formulas),
        "dependency_count": len(dependencies),
        "prerequisite_count": len(prerequisites),
        "ambiguous_count": len(payload.get("ambiguous") or []),
        "ambiguous_family_count": sum(1 for item in payload.get("ambiguous") or [] if item.get("edge_evidence") == "family_candidate"),
        "edge_status_counts": dict(sorted(edge_status_counts.items())),
        "edge_evidence_counts": dict(sorted(edge_evidence_counts.items())),
        "family_candidate_prerequisite_count": len(family_in_prereqs),
        "nonaccepted_prerequisite_count": len(nonaccepted_in_prereqs),
        "operator_pollution": operator_pollution,
        "fallback_definition_count": len(fallback_definitions),
        "family_candidate_prerequisites": family_in_prereqs[:20],
        "nonaccepted_prerequisites": nonaccepted_in_prereqs[:20],
        "fallback_definitions": fallback_definitions[:20],
    }


def raw_formula_number(formula_id: str) -> str:
    return str(formula_id).removeprefix("formula_")


def formula_sort_key(formula_id: str) -> tuple[int, int, str]:
    raw = raw_formula_number(formula_id)
    match = raw.replace("A", "31.").split(".", 2)
    if len(match) >= 2 and match[0].isdigit():
        numeric = "".join(ch for ch in match[1] if ch.isdigit())
        suffix = "".join(ch for ch in match[1] if ch.isalpha())
        return int(match[0]), int(numeric or 0), suffix
    return 10_000, 10_000, raw


def default_review_ids(chapter: dict[str, Any], limit: int = DEFAULT_REVIEW_LIMIT) -> list[str]:
    chapter_id = str(chapter.get("chapter_id") or "")
    if chapter_id in CHAPTER_REVIEW_IDS:
        return CHAPTER_REVIEW_IDS[chapter_id]

    dependencies = chapter.get("dependencies") or []
    formulas = chapter.get("formulas") or []
    formula_ids = [formula["id"] for formula in formulas]
    prereq_counts = Counter(
        prereq.get("target_id")
        for dependency in dependencies
        for prereq in dependency.get("prerequisites") or []
        if prereq.get("target_id")
    )
    selected: list[str] = []
    for formula_id, _count in prereq_counts.most_common(limit // 2):
        if formula_id and formula_id not in selected:
            selected.append(formula_id)
    zero_prereq_ids = [dependency.get("dependent_id") for dependency in dependencies if not dependency.get("prerequisites")]
    for formula_id in zero_prereq_ids[: max(3, limit // 4)]:
        if formula_id and formula_id not in selected:
            selected.append(formula_id)
    for formula_id in formula_ids[:: max(1, len(formula_ids) // max(1, limit))]:
        if formula_id and formula_id not in selected:
            selected.append(formula_id)
        if len(selected) >= limit:
            break
    return sorted(selected[:limit], key=formula_sort_key)


def build_review_bundle(dependency_dir: Path, chapter_id: str) -> dict[str, Any]:
    chapter_path = dependency_dir / f"{chapter_id}_dependencies.json"
    if not chapter_path.exists():
        raise FileNotFoundError(f"No dependency file found for {chapter_id}: {chapter_path}")
    chapter = read_json(chapter_path)
    dependencies = chapter.get("dependencies") or []
    formulas = chapter.get("formulas") or []
    formula_by_id = {formula["id"]: formula for formula in formulas}
    dependencies_by_id = {dependency["dependent_id"]: dependency for dependency in dependencies}
    review_ids = default_review_ids(chapter)

    prereq_counter: Counter[str] = Counter()
    formula_prereq_counter: Counter[str] = Counter()
    variable_prereq_counter: Counter[str] = Counter()
    for dependency in dependencies:
        for prereq in dependency.get("prerequisites") or []:
            target_id = prereq.get("target_id")
            if not target_id:
                continue
            prereq_counter[target_id] += 1
            if prereq.get("type") == "formula":
                formula_prereq_counter[target_id] += 1
            if prereq.get("type") == "variable_definition":
                variable_prereq_counter[target_id] += 1

    top_target = prereq_counter.most_common(1)
    return {
        "bundle_type": "chapter_graph_review",
        "chapter_id": chapter_id,
        "generated_at": utc_now(),
        "sources": {
            "dependency": f"data/frontend/dependency/{chapter_id}_dependencies.json",
        },
        "stats": {
            "formula_count": len(formulas),
            "dependency_count": len(dependencies),
            "symbol_index_keys": len(chapter.get("symbol_index") or {}),
            "ambiguous_count": len(chapter.get("ambiguous") or []),
            "family_candidate_prerequisite_count": sum(
                1
                for dependency in dependencies
                for prereq in dependency.get("prerequisites") or []
                if prereq.get("edge_evidence") == "family_candidate"
            ),
            "nonaccepted_prerequisite_count": sum(
                1
                for dependency in dependencies
                for prereq in dependency.get("prerequisites") or []
                if prereq.get("edge_status") not in (None, "accepted")
            ),
            "zero_prereq_formula_count": sum(1 for dependency in dependencies if not dependency.get("prerequisites")),
            "top_prereq_formula": {
                "id": top_target[0][0] if top_target else None,
                "total": top_target[0][1] if top_target else 0,
                "formula": formula_prereq_counter.get(top_target[0][0], 0) if top_target else 0,
                "variable_definition": variable_prereq_counter.get(top_target[0][0], 0) if top_target else 0,
            },
        },
        "review_focus": {
            formula_id: {
                "formula": formula_by_id.get(formula_id),
                "dependency": dependencies_by_id.get(formula_id),
            }
            for formula_id in review_ids
        },
        "ambiguous": chapter.get("ambiguous") or [],
        "chapter": chapter,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dependency-dir", type=Path, default=DEFAULT_DEPENDENCY_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--bundle-chapter", default=DEFAULT_BUNDLE_CHAPTER, help="Chapter id for the review bundle, e.g. chapter6.")
    parser.add_argument("--bundle-output", type=Path, help="Optional review bundle path. Defaults to tmp/<chapter>_graph_review_bundle.json.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    chapters = [audit_chapter(path) for path in iter_dependency_files(args.dependency_dir)]
    totals = {
        "chapters": len(chapters),
        "formulas": sum(item["formula_count"] for item in chapters),
        "dependencies": sum(item["dependency_count"] for item in chapters),
        "prerequisites": sum(item["prerequisite_count"] for item in chapters),
        "ambiguous": sum(item["ambiguous_count"] for item in chapters),
        "family_candidate_prerequisites": sum(item["family_candidate_prerequisite_count"] for item in chapters),
        "nonaccepted_prerequisites": sum(item["nonaccepted_prerequisite_count"] for item in chapters),
        "fallback_definitions": sum(item["fallback_definition_count"] for item in chapters),
        "operator_pollution_chapters": [
            item["chapter_id"] for item in chapters if item["operator_pollution"]
        ],
    }
    report = {
        "generated_at": utc_now(),
        "dependency_dir": str(args.dependency_dir),
        "totals": totals,
        "chapters": chapters,
    }
    bundle_output = args.bundle_output or PROJECT_ROOT / "tmp" / f"{args.bundle_chapter}_graph_review_bundle.json"
    write_json(args.output, report)
    write_json(bundle_output, build_review_bundle(args.dependency_dir, args.bundle_chapter))
    print(f"wrote {args.output}")
    print(f"wrote {bundle_output}")
    print(json.dumps(totals, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

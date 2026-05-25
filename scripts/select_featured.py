"""Select representative formulas for the 3D StarField.

This module can be used by the full dependency pipeline or run directly
against already-generated chapter dependency JSON. It keeps the frontend ID
contract intact: formula IDs are public IDs such as ``formula_2.1``.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
from typing import Any


DEFAULT_TARGET_COUNT = 240
MIN_FEATURED_COUNT = 230
MAX_FEATURED_COUNT = 250


CHAPTER_RE = re.compile(r"chapter(\d+)", re.IGNORECASE)
APPENDIX_RE = re.compile(r"appendix(\d+)", re.IGNORECASE)
FORMULA_RE = re.compile(r"formula_(\d+)(?:\.(\d+))?([a-z]?)")
APPENDIX_FORMULA_RE = re.compile(r"formula_A(\d+)(?:\.(\d+))?([a-z]?)", re.IGNORECASE)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def chapter_sort_key(chapter_id: str) -> int:
    match = CHAPTER_RE.search(str(chapter_id))
    if match:
        return int(match.group(1))
    appendix_match = APPENDIX_RE.search(str(chapter_id))
    if appendix_match:
        return 30 + int(appendix_match.group(1))
    return 10_000


def formula_sort_key(formula_id: str) -> tuple[int, int, str]:
    appendix_match = APPENDIX_FORMULA_RE.match(str(formula_id))
    if appendix_match:
        return 30 + int(appendix_match.group(1)), int(appendix_match.group(2) or 0), appendix_match.group(3)
    match = FORMULA_RE.match(str(formula_id))
    if match:
        return int(match.group(1)), int(match.group(2) or 0), match.group(3)
    return 10_000, 10_000, str(formula_id)


def raw_formula_id(public_id: str) -> str:
    return str(public_id).removeprefix("formula_")


def formula_chapter(formula: dict[str, Any]) -> int:
    if formula.get("chapter") is not None:
        return int(formula["chapter"])
    if formula.get("chapter_id"):
        return chapter_sort_key(str(formula["chapter_id"]))
    return formula_sort_key(str(formula["id"]))[0]


def display_name(formula: dict[str, Any]) -> str:
    raw = formula.get("raw_id", raw_formula_id(formula["id"]))
    context = formula.get("context_text") or formula.get("context") or ""
    for keyword in ("HKA", "MK", "Price", "Wright", "Fisher", "Robertson", "breeder", "selection"):
        if keyword.lower() in context.lower():
            return f"{keyword} {raw}"
    return f"Formula {raw}"


def score_formula(formula: dict[str, Any], incoming: Counter[str], outgoing: Counter[str], chapter_rank: int = 0) -> float:
    formula_id = formula["id"]
    latex = formula.get("latex") or formula.get("latex_preview") or ""
    length_bonus = max(0, 1600 - len(latex)) / 1600
    rank_bonus = max(0, 20 - chapter_rank) / 20
    return incoming[formula_id] * 3.0 + outgoing[formula_id] * 1.35 + length_bonus + rank_bonus * 0.35


def make_featured_item(formula: dict[str, Any], importance: float) -> dict[str, Any]:
    raw = formula.get("raw_id", raw_formula_id(formula["id"]))
    return {
        "id": formula["id"],
        "chapter": str(formula_chapter(formula)),
        "chapter_id": formula.get("chapter_id") or f"chapter{formula_chapter(formula)}",
        "label": formula.get("label", f"Formula {raw}"),
        "display_name": display_name(formula),
        "importance": round(float(importance), 4),
        "latex_preview": formula.get("latex") or formula.get("latex_preview") or "",
    }


def build_featured_formulas(
    all_formulas: list[dict[str, Any]],
    all_dependencies: list[dict[str, Any]],
    target_count: int = DEFAULT_TARGET_COUNT,
) -> dict[str, list[dict[str, Any]]]:
    """Return 230-250 representative formulas with even chapter coverage.

    Selection is intentionally two-stage:
    1. Pick a strong quota from each chapter so the starfield does not collapse
       into a few citation-heavy chapters.
    2. Fill remaining capacity globally by graph centrality.
    """

    target = max(MIN_FEATURED_COUNT, min(MAX_FEATURED_COUNT, target_count))
    incoming: Counter[str] = Counter()
    outgoing: Counter[str] = Counter()
    for dep in all_dependencies:
        dependent = dep["dependent_id"]
        outgoing[dependent] += len(dep.get("prerequisites") or [])
        for prereq in dep.get("prerequisites") or []:
            if prereq.get("type") == "formula" and prereq.get("target_id"):
                incoming[prereq["target_id"]] += 1

    by_chapter: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for formula in all_formulas:
        by_chapter[formula_chapter(formula)].append(formula)

    chapters = sorted(by_chapter)
    if not chapters:
        return {"featured": []}

    per_chapter = max(1, target // len(chapters))
    featured: list[dict[str, Any]] = []
    used: set[str] = set()

    for chapter in chapters:
        ranked = sorted(
            by_chapter[chapter],
            key=lambda formula: (score_formula(formula, incoming, outgoing), -formula_sort_key(formula["id"])[1]),
            reverse=True,
        )
        for rank, formula in enumerate(ranked[:per_chapter]):
            used.add(formula["id"])
            featured.append(make_featured_item(formula, score_formula(formula, incoming, outgoing, rank)))

    global_candidates: list[tuple[float, dict[str, Any]]] = []
    for formula in all_formulas:
        if formula["id"] in used:
            continue
        global_candidates.append((score_formula(formula, incoming, outgoing), formula))

    for _, formula in sorted(global_candidates, key=lambda item: (item[0], formula_sort_key(item[1]["id"])), reverse=True):
        if len(featured) >= target:
            break
        used.add(formula["id"])
        featured.append(make_featured_item(formula, score_formula(formula, incoming, outgoing)))

    featured = sorted(featured, key=lambda item: (chapter_sort_key(item.get("chapter_id", "")), -item["importance"], formula_sort_key(item["id"])))
    return {"featured": featured[:target]}


def load_from_dependency_dir(dependency_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    formulas_by_id: dict[str, dict[str, Any]] = {}
    dependencies: list[dict[str, Any]] = []
    for path in sorted(dependency_dir.glob("*_dependencies.json"), key=lambda item: chapter_sort_key(item.name)):
        payload = read_json(path)
        for formula in payload.get("formulas") or []:
            formula = {
                **formula,
                "chapter_id": payload.get("chapter_id"),
                "chapter": chapter_sort_key(str(payload.get("chapter_id", ""))),
            }
            formulas_by_id[formula["id"]] = formula
        dependencies.extend(payload.get("dependencies") or [])
    return list(formulas_by_id.values()), dependencies


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dependency-dir", type=Path, default=Path("data/frontend/dependency"))
    parser.add_argument("--output", type=Path, default=Path("data/frontend/featured_formulas.json"))
    parser.add_argument("--public-output", type=Path, default=Path("public/data/featured_formulas.json"))
    parser.add_argument("--target-count", type=int, default=DEFAULT_TARGET_COUNT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    formulas, dependencies = load_from_dependency_dir(args.dependency_dir)
    payload = build_featured_formulas(formulas, dependencies, target_count=args.target_count)
    write_json(args.output, payload)
    write_json(args.public_output, payload)
    print(f"Wrote {len(payload['featured'])} featured formulas to {args.output} and {args.public_output}")


if __name__ == "__main__":
    main()

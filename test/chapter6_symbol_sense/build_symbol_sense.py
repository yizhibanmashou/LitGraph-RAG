"""
Symbol Sense 驱动的公式先修关系构建 — chapter6 实验。

严格遵循 docs/formula_prerequisite_graph_design.md 的设计思路:
  1. 读取章节内全部公式（复用已有的 symbols_used / symbols_defined）
  2. 按公式位置从前往后扫描
  3. 建立章节级 Symbol Sense 哈希表 (symbol -> [sense_id])
  4. 对每个公式的每个 used symbol，查找最近的上游 symbol sense
  5. matched sense 的定义来源是公式 → formula prerequisite item
  6. matched sense 的来源是文本 → variable_definition item
  7. 当前公式的 symbols_defined 写入/合并到 Symbol Sense 哈希表
  8. 同符号多义 → 创建新 sense_id，不强行覆盖
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
STRUCTURED_DIR = DATA_DIR / "structured"
DEPENDENCY_DIR = DATA_DIR / "frontend" / "dependency"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"

# ---------------------------------------------------------------------------
# symbol extraction helpers (simplified, reusing logic from scripts/)
# ---------------------------------------------------------------------------
GREEK_MACROS = {
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon",
    "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda",
    "mu", "nu", "xi", "pi", "rho", "varrho", "sigma", "tau",
    "upsilon", "phi", "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma",
    "Upsilon", "Phi", "Psi", "Omega",
}

OPERATOR_MACROS = {
    "Pr", "P", "E", "Var", "Cov", "cov", "corr",
    "det", "exp", "log", "ln", "max", "min",
}

STYLE_MACROS = {
    "bar", "overline", "hat", "widehat", "tilde", "widetilde",
    "vec", "mathbf", "boldsymbol", "mathbb", "mathcal", "mathscr",
    "mathrm", "mathit", "mathsf", "operatorname",
}

NON_SYMBOL_MACROS = {
    "frac", "dfrac", "tfrac", "sqrt",
    "sum", "prod", "int", "iint", "iiint",
    "left", "right", "big", "Big", "bigg", "Bigg",
    "begin", "end", "limits", "nolimits", "binom", "choose",
    "cdot", "times", "pm", "mp",
    "le", "leq", "ge", "geq", "neq", "approx", "simeq", "sim", "propto",
    "to", "rightarrow", "leftarrow", "leftrightarrow",
    "infty", "ldots", "cdots", "dots",
    "qquad", "quad", " ", ",", ";", ":", "!",
}

# symbols that are very common and typically not "defined" by a formula
GENERIC_SYMBOLS = {
    "i", "j", "k", "l", "n", "m", "N", "t", "x", "y", "z",
    "\\alpha", "\\beta", "\\gamma", "\\delta", "\\epsilon",
    "\\lambda", "\\mu", "\\tau", "\\omega",
}


def family_key(symbol: str) -> str:
    """提取符号家族键，去除装饰和上下标。"""
    value = symbol.strip()
    for macro in STYLE_MACROS:
        value = value.replace(f"\\{macro}", "")
    # 去除残留的花括号（如 \\overline{z} 去掉 \\overline 后剩 {z}）
    value = value.replace("{", "").replace("}", "")
    value = re.sub(r"[_^](?:\{[^{}]*\}|\\?[A-Za-z0-9]+)", "", value)
    value = value.replace("(", "").replace(")", "")
    return value or symbol.strip()


def is_generic_symbol(symbol: str) -> bool:
    """判断是否为通用符号（索引、临时变量等）。
    只检查原始符号本身，不检查 family_key，避免误判带装饰的符号。"""
    if symbol in GENERIC_SYMBOLS:
        return True
    # 也检查带下标的裸符号，如 x_i, z_i
    base = re.sub(r"[_^].*$", "", symbol)
    if base in GENERIC_SYMBOLS and base != symbol:
        # 有下标或上标的裸符号也可能是通用索引，但需要看具体情况
        # 保守起见，仅当 base 是简单拉丁字母时视为通用
        if len(base) == 1 and base.isalpha():
            return True
    return False


# ---------------------------------------------------------------------------
# variable definition extraction from structured text
# ---------------------------------------------------------------------------
VAR_DEF_PATTERNS = [
    # "let X be ..."
    re.compile(r"let\s+\$?\s*(\\?[A-Za-z0-9_{}\^_]+)\s*\$?\s+(?:be|denote|represent)\b", re.IGNORECASE),
    # "where X is/are ..."
    re.compile(r"where\s+\$?\s*(\\?[A-Za-z0-9_{}\^_]+)\s*\$?\s+(?:is|are|denotes?|represents?)\b", re.IGNORECASE),
    # "X denotes/represents/is the ..."
    re.compile(r"\$?\s*(\\[A-Za-z]+)\s*\$?\s+(?:denotes?|represents?|is the|are the)\b", re.IGNORECASE),
    # "X is called the ..."
    re.compile(r"\$?\s*(\\?[A-Za-z0-9_{}\^_]+)\s*\$?\s+is called the\b", re.IGNORECASE),
    # "call this X"
    re.compile(r"call this\s+\$?\s*(\\?[A-Za-z0-9_{}\^_]+)\s*\$?", re.IGNORECASE),
]

# patterns for extracting definition text (the part after "is/are")
DEF_TEXT_PATTERNS = [
    re.compile(
        r"(?:is|are|denotes?|represents?)\s+(.{10,120}?)(?:[.;]|$)", re.IGNORECASE
    ),
    re.compile(
        r"(?:be|denote|represent)\s+(.{10,120}?)(?:[.;]|$)", re.IGNORECASE
    ),
]


def extract_variable_definitions_from_text(text: str) -> list[dict[str, str]]:
    """从文本中抽取变量定义候选。"""
    definitions: list[dict[str, str]] = []
    seen_symbols: set[str] = set()

    for pattern in VAR_DEF_PATTERNS:
        for match in pattern.finditer(text):
            symbol = match.group(1).strip()
            symbol = symbol.replace("$", "")
            if symbol in seen_symbols:
                continue
            seen_symbols.add(symbol)

            # try to extract the definition text
            remaining = text[match.end():]
            def_text = ""
            for def_pattern in DEF_TEXT_PATTERNS:
                def_match = def_pattern.search(remaining)
                if def_match:
                    def_text = def_match.group(1).strip()
                    break

            if not def_text:
                # grab next ~80 chars
                def_text = remaining[:80].strip().rstrip(".;")

            definitions.append({
                "symbol": symbol,
                "definition": def_text,
                "source": "nearby_text",
            })

    return definitions


def load_all_chapter_texts(chapter_id: str) -> list[dict[str, Any]]:
    """加载章节所有结构化文本块。"""
    texts: list[dict[str, Any]] = []
    for path in sorted(STRUCTURED_DIR.glob(f"{chapter_id}_*.json")):
        try:
            with path.open("r", encoding="utf-8-sig") as fh:
                doc = json.load(fh)
        except Exception:
            continue
        doc_chapter = (doc.get("metadata") or {}).get("chapter", "")
        if doc_chapter != chapter_id:
            continue
        metadata = doc.get("metadata") or {}
        for block in doc.get("blocks") or []:
            content = block.get("content", "")
            if not content:
                continue
            texts.append({
                "content": content,
                "section": metadata.get("section_level_1", ""),
                "subsection": metadata.get("section_level_2", ""),
                "source_chunk_id": doc.get("id", ""),
            })
    return texts


def build_text_variable_index(
    chapter_id: str,
) -> dict[str, list[dict[str, Any]]]:
    """构建文本中变量定义的索引 symbol -> [definitions]"""
    index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    texts = load_all_chapter_texts(chapter_id)
    for text_entry in texts:
        defs = extract_variable_definitions_from_text(text_entry["content"])
        for d in defs:
            entry = {**d, **text_entry}
            index[d["symbol"]].append(entry)
    return dict(index)


# ---------------------------------------------------------------------------
# Symbol Sense 注册表
# ---------------------------------------------------------------------------
def build_symbol_sense_registry(
    formulas: list[dict[str, Any]],
    chapter_id: str,
    text_var_index: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, list[str]], dict[str, dict[str, Any]]]:
    """
    构建章节级 Symbol Sense 哈希表。

    按公式位置从前往后扫描。对每个公式：
      对于 symbols_defined，如果该符号已有 sense(s)，判断是否合并或新建。
    """
    symbol_index: dict[str, list[str]] = {}
    senses: dict[str, dict[str, Any]] = {}

    for formula in formulas:
        for sym_entry in formula.get("symbols_defined_detailed", []):
            symbol = sym_entry["symbol"]
            fk = sym_entry.get("family_key", family_key(symbol))

            existing_sense_ids = symbol_index.get(symbol, [])
            merged = False

            if existing_sense_ids:
                # 检查最近的一个 sense
                for sid in reversed(existing_sense_ids):
                    existing = senses.get(sid)
                    if not existing:
                        continue
                    # 同一章节内同符号，默认合并（扩展 scope）
                    if existing.get("family_key") == fk:
                        existing.setdefault("definition_sources", [])
                        existing["definition_sources"].append({
                            "type": "formula",
                            "id": formula["id"],
                            "position": formula.get("position", 0),
                        })
                        existing.setdefault("examples", [])
                        existing["examples"].append(formula.get("latex", ""))
                        scope = existing.setdefault("scope", {})
                        scope["end_position"] = formula.get("position", 0)
                        # 更新 defined_by 为最近的定义来源
                        existing["defined_by"] = {
                            "type": "formula",
                            "id": formula["id"],
                        }
                        merged = True
                        break

            if not merged:
                sense_id = f"{chapter_id}_{symbol.replace(chr(92), '')}_{len(senses):03d}"
                sense = {
                    "sense_id": sense_id,
                    "symbol": symbol,
                    "normalized_symbol": symbol,
                    "family_key": fk,
                    "meaning": f"Defined by {formula['id']}",
                    "scope": {
                        "chapter_id": chapter_id,
                        "section_id": formula.get("section", ""),
                        "start_position": formula.get("position", 0),
                        "end_position": formula.get("position", 0),
                    },
                    "defined_by": {
                        "type": "formula",
                        "id": formula["id"],
                    },
                    "definition_sources": [
                        {"type": "formula", "id": formula["id"]}
                    ],
                    "examples": [formula.get("latex", "")],
                    "confidence": 0.86,
                }
                senses[sense_id] = sense
                symbol_index.setdefault(symbol, []).append(sense_id)

            # 也注册 symbol family key
            family_idx_key = f"family:{fk}"
            if sense_id not in symbol_index.get(family_idx_key, []):
                symbol_index.setdefault(family_idx_key, []).append(sense_id)

    # 注册文本中的变量定义
    for symbol, var_defs in text_var_index.items():
        for vd in var_defs:
            sense_id = f"{chapter_id}_text_{symbol.replace(chr(92), '')}_{len(senses):03d}"
            sense = {
                "sense_id": sense_id,
                "symbol": symbol,
                "normalized_symbol": symbol,
                "family_key": family_key(symbol),
                "meaning": vd.get("definition", ""),
                "scope": {
                    "chapter_id": chapter_id,
                    "section_id": vd.get("section", ""),
                    "start_position": -1,
                    "end_position": -1,
                },
                "defined_by": {
                    "type": "text",
                    "source_chunk_id": vd.get("source_chunk_id", ""),
                },
                "definition_sources": [
                    {
                        "type": "text",
                        "source_chunk_id": vd.get("source_chunk_id", ""),
                        "definition": vd.get("definition", ""),
                    }
                ],
                "examples": [],
                "confidence": 0.65,
            }
            senses[sense_id] = sense
            symbol_index.setdefault(symbol, []).append(sense_id)

    return dict(symbol_index), senses


# ---------------------------------------------------------------------------
# 依赖查找
# ---------------------------------------------------------------------------
def find_upstream_sense(
    symbol: str,
    fk: str,
    current_position: int,
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
    chapter_id: str,
) -> dict[str, Any] | None:
    """查找当前符号在章节内最近的上游 sense（只找当前位置之前的）。

    返回的 sense 中 defined_by 会被临时替换为最晚的、position < current_position 的定义来源。
    """
    candidates = list(symbol_index.get(symbol, []))
    # 也按 family key 查找
    for sid in symbol_index.get(f"family:{fk}", []):
        if sid not in candidates:
            candidates.append(sid)

    best: dict[str, Any] | None = None
    best_pos = -1
    best_source: dict[str, Any] = {}

    for sid in candidates:
        sense = senses.get(sid)
        if not sense:
            continue
        scope = sense.get("scope", {})
        if scope.get("chapter_id") != chapter_id:
            continue

        # 从 definition_sources 中找到满足 position < current_position 的最新定义
        sources = sense.get("definition_sources", [])
        for src in sources:
            src_pos = src.get("position", scope.get("start_position", -1))
            if src_pos < 0 or src_pos >= current_position:
                continue
            if src_pos > best_pos:
                best_pos = src_pos
                best = dict(sense)
                best_source = src

    if best is None:
        return None

    # 临时设置 defined_by 为最接近的定义来源
    if best_source.get("type") == "formula":
        best["defined_by"] = {"type": "formula", "id": best_source.get("id", "")}
    elif best_source.get("type") == "text":
        best["defined_by"] = {"type": "text", "source_chunk_id": best_source.get("source_chunk_id", "")}
        best["meaning"] = best_source.get("definition", best.get("meaning", ""))

    return best


# ---------------------------------------------------------------------------
# 主构建流程
# ---------------------------------------------------------------------------
def build_prerequisite_graph(
    formulas: list[dict[str, Any]],
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
    chapter_id: str,
    text_var_index: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    对每个公式，构建 prerequisite 列表。

    处理顺序（显式先处理 symbols_used → 再注册 symbols_defined 已在 build_symbol_sense_registry 完成）。
    这里对每个公式的每个 symbols_used 查找 prerequisite。
    """
    dependencies: list[dict[str, Any]] = []
    ambiguous_symbols: list[dict[str, Any]] = []

    for formula in formulas:
        items: list[dict[str, Any]] = []
        seen_targets: set[tuple[str, str]] = set()
        used_symbols = formula.get("symbols_used_detailed", [])
        defined_symbols = set(formula.get("symbols_defined", []))

        for sym_entry in used_symbols:
            symbol = sym_entry["symbol"]
            fk = sym_entry.get("family_key", family_key(symbol))

            # 跳过当前公式自己定义的符号
            if symbol in defined_symbols:
                continue

            # 查找上游 sense
            sense = find_upstream_sense(
                symbol, fk, formula.get("position", 0),
                symbol_index, senses, chapter_id,
            )

            if sense:
                defined_by = sense.get("defined_by", {})
                if defined_by.get("type") == "formula" and not is_generic_symbol(symbol):
                    target_id = defined_by.get("id", "")
                    if target_id and target_id != formula["id"]:
                        key = ("formula", target_id)
                        if key not in seen_targets:
                            seen_targets.add(key)
                            items.append({
                                "type": "formula",
                                "target_id": target_id,
                                "via_symbol": symbol,
                                "relation": "defines_symbol",
                                "reason": f"{symbol} defined by nearest upstream formula ({target_id}) in {chapter_id}",
                                "confidence": 0.84,
                                "cross_chapter": False,
                            })
                elif defined_by.get("type") == "text":
                    key = ("variable_definition", symbol)
                    if key not in seen_targets:
                        seen_targets.add(key)
                        items.append({
                            "type": "variable_definition",
                            "symbol": symbol,
                            "definition": sense.get("meaning", ""),
                            "source": "nearby_text",
                            "source_chunk_id": defined_by.get("source_chunk_id", ""),
                            "confidence": sense.get("confidence", 0.65),
                        })
            else:
                # 没有找到上游公式定义 → 检查文本变量索引
                var_defs = text_var_index.get(symbol, [])
                if var_defs:
                    best_vd = var_defs[0]  # 取第一个匹配
                    key = ("variable_definition", symbol)
                    if key not in seen_targets:
                        seen_targets.add(key)
                        items.append({
                            "type": "variable_definition",
                            "symbol": symbol,
                            "definition": best_vd.get("definition", f"Variable {symbol}"),
                            "source": "nearby_text",
                            "source_chunk_id": best_vd.get("source_chunk_id", ""),
                            "confidence": 0.55,
                        })
                elif not is_generic_symbol(symbol):
                    # 既没有公式来源也没有文本定义 → 标记为通用变量
                    key = ("variable_definition", symbol)
                    if key not in seen_targets:
                        seen_targets.add(key)
                        items.append({
                            "type": "variable_definition",
                            "symbol": symbol,
                            "definition": f"Variable {symbol} (context-defined)",
                            "source": "context",
                            "source_chunk_id": formula.get("source_chunk_id", ""),
                            "confidence": 0.40,
                        })

        # 排重 & 排序：formula 类型在前，variable_definition 在后
        formula_items = [i for i in items if i["type"] == "formula"]
        var_items = [i for i in items if i["type"] == "variable_definition"]
        dependencies.append({
            "dependent_id": formula["id"],
            "prerequisites": formula_items + var_items,
        })

    return dependencies, ambiguous_symbols


def serializable_formula(formula: dict[str, Any]) -> dict[str, Any]:
    """Return the formula fields consumed by the current frontend graph data contract."""
    return {
        "id": formula["id"],
        "latex": formula.get("latex", ""),
        "label": formula.get("label", f"Formula {formula['id']}"),
        "section": formula.get("section", ""),
        "subsection": formula.get("subsection", ""),
        "position": formula.get("position", 0),
        "context_text": formula.get("context_text", ""),
        "symbols_used": formula.get("symbols_used", []),
        "symbols_defined": formula.get("symbols_defined", []),
    }


def build_frontend_symbol_index(formulas: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Build the same public symbol index shape as data/frontend/dependency/*.json."""
    index: dict[str, list[str]] = {}
    for formula in formulas:
        for sym_entry in formula.get("symbols_defined_detailed", []):
            symbol = sym_entry["symbol"]
            value = f"{formula['id']}::{symbol}"
            bucket = index.setdefault(symbol, [])
            if value not in bucket:
                bucket.append(value)
    return index


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main() -> None:
    chapter_id = "chapter6"

    # 1. 读取已有公式数据
    dep_path = DEPENDENCY_DIR / f"{chapter_id}_dependencies.json"
    with dep_path.open("r", encoding="utf-8") as fh:
        existing = json.load(fh)

    formulas = existing["formulas"]
    print(f"[1/5] 加载了 {len(formulas)} 条公式")

    # 补充 symbols_used_detailed / symbols_defined_detailed
    for f in formulas:
        if "symbols_used_detailed" not in f:
            f["symbols_used_detailed"] = [
                {"symbol": s, "family_key": family_key(s)}
                for s in f.get("symbols_used", [])
            ]
        if "symbols_defined_detailed" not in f:
            f["symbols_defined_detailed"] = [
                {"symbol": s, "family_key": family_key(s)}
                for s in f.get("symbols_defined", [])
            ]

    # 2. 构建文本变量索引
    print("[2/5] 从结构化文本中抽取变量定义...")
    text_var_index = build_text_variable_index(chapter_id)
    print(f"      从文本中抽取了 {sum(len(v) for v in text_var_index.values())} 条变量定义候选")

    # 3. 构建 Symbol Sense 注册表
    print("[3/5] 构建章节级 Symbol Sense 注册表...")
    symbol_index, senses = build_symbol_sense_registry(formulas, chapter_id, text_var_index)
    print(f"      共 {len(senses)} 个 sense，{len(symbol_index)} 个 symbol key")

    # 4. 构建 prerequisite graph
    print("[4/5] 构建公式先修关系图...")
    dependencies, ambiguous = build_prerequisite_graph(
        formulas, symbol_index, senses, chapter_id, text_var_index,
    )

    total_edges = sum(len(dep["prerequisites"]) for dep in dependencies)
    formula_edges = sum(
        sum(1 for i in dep["prerequisites"] if i["type"] == "formula")
        for dep in dependencies
    )
    var_edges = sum(
        sum(1 for i in dep["prerequisites"] if i["type"] == "variable_definition")
        for dep in dependencies
    )
    print(f"      共 {total_edges} 条 prerequisite 边 ({formula_edges} formula, {var_edges} variable_definition)")

    # 5. 输出
    print("[5/5] 输出结果...")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 按当前前端图谱格式输出，便于直接替换 data/frontend 与 public/data 的 chapter dependency 文件。
    output = {
        "chapter_id": chapter_id,
        "version": 1,
        "generated_at": utc_now(),
        "formulas": [serializable_formula(f) for f in formulas],
        "symbol_index": build_frontend_symbol_index(formulas),
        "dependencies": dependencies,
        "ambiguous": ambiguous,
    }

    output_path = OUTPUT_DIR / f"{chapter_id}_symbol_sense_dependencies.json"
    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(output, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"\n输出文件: {output_path}")
    print(f"文件大小: {output_path.stat().st_size / 1024:.1f} KB")

    # 打印一些示例
    print("\n===== 示例输出 =====")
    for dep in dependencies:
        if dep["prerequisites"]:
            fid = dep["dependent_id"]
            f_items = [i for i in dep["prerequisites"] if i["type"] == "formula"]
            v_items = [i for i in dep["prerequisites"] if i["type"] == "variable_definition"]
            if f_items or v_items:
                print(f"\n  [{fid}]")
                for fi in f_items:
                    print(f"    ← formula: {fi['target_id']} (via {fi['via_symbol']})")
                for vi in v_items[:3]:
                    print(f"    ← var_def: {vi['symbol']} = {vi['definition'][:60]}")
                if len(v_items) > 3:
                    print(f"    ... and {len(v_items) - 3} more variable definitions")


if __name__ == "__main__":
    main()

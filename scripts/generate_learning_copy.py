import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEARCH_INDEX_PATH = ROOT / "data" / "frontend" / "formula_search_index.json"
CACHE_PATH = ROOT / "data" / "frontend" / "formula_learning_copy.json"
API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"


def read_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def context_hash(formula):
    source = "\n".join([
        formula.get("id", ""),
        formula.get("latex_preview", ""),
        formula.get("context", ""),
    ])
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def select_formulas(formulas, ids, limit):
    if ids:
        wanted = set(ids)
        selected = [formula for formula in formulas if formula.get("id") in wanted]
        missing = sorted(wanted - {formula.get("id") for formula in selected})
        if missing:
            print(f"Missing formula ids: {', '.join(missing)}", file=sys.stderr)
        return selected
    return formulas[:limit] if limit is not None else formulas


def build_prompt(formula):
    return f"""Generate learner-facing formula explanations for a Knowstellation knowledge graph.

Return strict JSON only, with this exact shape:
{{
  "en": {{
    "plainMeaning": "...",
    "inThisChapter": "..."
  }},
  "zh": {{
    "plainMeaning": "...",
    "inThisChapter": "..."
  }}
}}

Rules:
- Do not quote the raw context mechanically.
- Explain what the formula means for a learner.
- Keep each field 1-2 concise sentences.
- Chinese must be natural Chinese, not word-by-word translation.
- Do not invent formula numbers or biological claims not supported by the context.

Formula id: {formula.get('id')}
Formula number: {formula.get('number')}
Label: {formula.get('label')}
Chapter: {formula.get('chapter')}
Section: {formula.get('section')}
LaTeX: {formula.get('latex_preview')}
Context: {formula.get('context')}
"""


def call_deepseek(api_key, formula):
    body = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You write accurate, concise bilingual learning notes for evolutionary genetics formulas. Return JSON only.",
            },
            {"role": "user", "content": build_prompt(formula)},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    content = payload["choices"][0]["message"]["content"]
    return json.loads(content)


def valid_copy(copy):
    return all(
        copy.get(language, {}).get(field)
        for language in ("en", "zh")
        for field in ("plainMeaning", "inThisChapter")
    )


def main():
    parser = argparse.ArgumentParser(description="Generate cached bilingual formula learning copy.")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of formulas to consider when --ids is not provided.")
    parser.add_argument("--ids", nargs="*", default=None, help="Specific formula ids to generate, e.g. formula_2.1 formula_10.1a.")
    parser.add_argument("--force", action="store_true", help="Regenerate even when the context hash matches.")
    args = parser.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("DEEPSEEK_API_KEY is not set", file=sys.stderr)
        return 1

    formulas = read_json(SEARCH_INDEX_PATH, [])
    cache = read_json(CACHE_PATH, {
        "version": 1,
        "generated_at": "",
        "source": "deepseek-local-cache",
        "items": {},
    })
    cache.setdefault("version", 1)
    cache.setdefault("source", "deepseek-local-cache")
    cache.setdefault("items", {})

    selected = select_formulas(formulas, args.ids, args.limit)
    generated = 0
    skipped = 0

    for formula in selected:
        formula_id = formula.get("id")
        if not formula_id:
            continue
        digest = context_hash(formula)
        current = cache["items"].get(formula_id)
        if current and current.get("source_context_hash") == digest and not args.force:
            skipped += 1
            continue

        try:
            copy = call_deepseek(api_key, formula)
        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError, TimeoutError) as error:
            print(f"failed {formula_id}: {error}", file=sys.stderr)
            continue

        if not valid_copy(copy):
            print(f"failed {formula_id}: model returned incomplete JSON", file=sys.stderr)
            continue

        cache["items"][formula_id] = {
            "en": copy["en"],
            "zh": copy["zh"],
            "source_context_hash": digest,
            "model": MODEL,
        }
        cache["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        generated += 1
        print(f"generated {formula_id}")

    write_json(CACHE_PATH, cache)
    print(f"wrote {CACHE_PATH}")
    print(f"generated={generated} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# LitGraph-RAG

LitGraph-RAG is an interactive formula graph for textbook reading. It builds chapter-local prerequisite graphs from structured textbook data, then renders formulas, variable definitions, storylines, and chapter maps in a React frontend.

The current pipeline is intentionally conservative: exact references, exact symbol matches, canonical notation matches, compound formula groups, and explicit text definitions can enter the main graph. Family-only symbol matches are kept as ambiguous review candidates instead of accepted edges.

## Current Focus

- Preserve teacher/textbook notation in symbols such as `F_{ST}`, `p_0`, `\bar{t}_c`, and `\overline{t}_c`.
- Filter mathematical operators such as `\sum`, `\prod`, `\ln`, `\exp`, `E(...)`, `\Pr(...)`, and `Var(...)` from variable dependency matching.
- Keep `\bar` and `\overline` canonicalized together, while keeping `\hat`, `\tilde`, `\dot`, and the plain variable as separate entities.
- Treat `family_key` as recall-only. It may create an ambiguous audit candidate, but it must not create a main graph prerequisite.
- Only show variable definition nodes when a nearby textbook sentence explicitly defines the variable.

## Data Pipeline

Build all frontend dependency data:

```powershell
python scripts\build_dependencies.py --all
```

Sync generated development data into the public frontend data folder:

```powershell
npm run sync:data
```

Audit graph quality and regenerate the chapter 2 review bundle:

```powershell
npm run audit:graph
```

Audit outputs:

- `tmp/dependency_graph_audit.json`
- `tmp/chapter2_graph_review_bundle.json`

Expected high-level audit invariants for the current conservative graph:

- `family_candidate_prerequisites` is `0`
- `nonaccepted_prerequisites` is `0`
- `fallback_definitions` is `0`
- `operator_pollution_chapters` is empty

## Symbol Sense Workflow

The Symbol Sense workflow exports prompts for external LLM review, then imports validated results without directly calling an LLM from the repo.

```powershell
npm run symbol-sense -- export-prompts
npm run symbol-sense -- import-results --chapter chapter6 --input path\to\raw.json
npm run symbol-sense -- convert --chapter chapter6
```

The first implementation writes normalized intermediate files under `data/frontend/symbol_sense/` and only overwrites `data/frontend/dependency` during conversion. It does not automatically publish to `public/data`.

## Frontend

Run the app locally:

```powershell
npm run dev
```

Build for production:

```powershell
npm run build
```

LLM-assisted explanations are optional enhancements. In development, Vite proxies
`/api/llm` to DeepSeek using server-side environment variables. In production,
deploy the `/api/llm` serverless proxy and configure:

```powershell
DEEPSEEK_API_KEY=
DEEPSEEK_API_BASE=https://api.deepseek.com
```

Do not expose DeepSeek keys through `VITE_*` variables; browser code should only
call `/api/llm`. When the proxy is unavailable, the frontend falls back to local
textbook explanations.

The graph supports three study modes:

- `guided`: default formula entry, with staged expansion.
- `focus`: single-formula close reading.
- `explore`: full chapter graph or free exploration.

Starter formulas, defined as formulas with `depth <= 0` and no accepted
same-chapter formula prerequisites, automatically show up to four compact
variable definition cards to the left of the formula card. Later formulas keep
the staged interaction: learners choose prerequisites or successors explicitly.

## Verification

Run the focused Python pipeline tests:

```powershell
npm run test:python
```

Run the Node/TypeScript tests:

```powershell
npm run test:node
```

Run the production build:

```powershell
npm run build
```

## Chapter 2 Calibration Notes

The current chapter 2 review bundle is designed for external audit. Key corrected cases include:

- `formula_2.12` no longer treats `E` or `\ln` as variables and no longer links `p` to `p_0`.
- `formula_2.7` no longer emits `\exp` as a variable definition.
- `formula_2.30a` and `formula_2.30b` are linked through a `compound_group` edge.
- `F(...)` function calls are separated from `F_{ST}`, `F_{DG}`, and related population-structure symbols.
- Family-only `F` or `T` matches remain in `ambiguous`, not in `dependencies[].prerequisites`.

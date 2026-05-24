# Investigation: `overview-data.js` `const CODEXU_UI` hoist vs. ralph-overview plugin parser

## The question

The codexu repo's `plans/overview-data.js` was refactored in commit `e39b9c06` (Plan-12 Phase-2 plugin migration) to hoist its UI configuration into a top-level `const CODEXU_UI = {...}` declaration and reference it from the `window.OVERVIEW_DATA = {...}` assignment as `"ui": CODEXU_UI`. This breaks the ralph-overview plugin's strict parser at `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/lib/parse-overview-data.mjs`, which requires:

1. Exactly ONE top-level statement (the `window.OVERVIEW_DATA = {...}` assignment).
2. The right-hand side must contain only literal nodes (object literals, array literals, strings, numbers, booleans, null, simple unary). Identifier references are unsupported.

The dev server, the overview MCP sync watcher, and the `overview_parallel_ready_tasks` / `overview_validate_data` MCP tools all fail with `expected a single window.OVERVIEW_DATA object assignment`.

**Which resolution path is preferable?** Three candidates:

- **A. Inline the hoist back** — collapse `const CODEXU_UI = {...}` and `"ui": CODEXU_UI` into a single inline `"ui": {...literal object...}` in `plans/overview-data.js`. The const goes away. The file becomes ~85 lines longer but conforms to the existing parser contract.

- **B. Extend the parser** — patch `parse-overview-data.mjs` (and `set-override-edit.js`'s `parseOverviewDataAssignment` for symmetry) to accept top-level `const`/`let`/`var` declarations whose initializers are literal values, then resolve Identifier references inside the `window.OVERVIEW_DATA = {...}` literal during `literalValue` evaluation. Preserves the hoist and unlocks future const-shared modular data files.

- **C. Hybrid** — accept the const declarations in the parser AST, but require their initializers to be self-contained literals; have `loadOverviewData` precompute an `identifierResolutionTable` and substitute during literalValue. (Mechanically similar to B but explicitly limits the surface to "const + literal-only initializer".)

## Verbatim evidence

### B.1 — The actual failure

```
$ pnpm overview  (or overview_dev_server_start MCP)
error when starting dev server:
Error: JavaScript syntax error: expected a single window.OVERVIEW_DATA object assignment
    at loadOverviewData (D:/ai-developer-toolkit/plugins/ralph-overview/scripts/lib/sync-core.mjs:825:15)
    at assembleStateFromBundles (sync-core.mjs:103:26)
    at walkRalphState (sync-core.mjs:58:12)
    at Module.start (watch-ralph-state.mjs:363:30)
    at async BasicMinimalPluginContext.configureServer (vite.config.ts.timestamp...mjs:174:20)

$ overview_parallel_ready_tasks (MCP)
JavaScript syntax error: expected a single window.OVERVIEW_DATA object assignment
```

### B.2 — Babel AST shape on the current file

```
$ node -e "const {parse}=require('@babel/parser'); ...parse(s,{sourceType:'script'})..."
statements: 2
  0  VariableDeclaration  @line 25   (const CODEXU_UI = {...})
  1  ExpressionStatement  @line 111  (window.OVERVIEW_DATA = {...})
```

### B.3 — The current strict parser (`parse-overview-data.mjs`)

```js
// D:/ai-developer-toolkit/plugins/ralph-overview/scripts/lib/parse-overview-data.mjs:1-30
import { parse } from '@babel/parser'

export function parseOverviewData(content) {
    let ast
    try {
        ast = parse(content, { sourceType: 'script' })
    } catch (error) {
        return { ok: false, error: `JavaScript syntax error: ${error instanceof Error ? error.message : String(error)}` }
    }

    const statements = ast.program?.body ?? []
    if (statements.length !== 1) {
        return { ok: false, error: 'JavaScript syntax error: expected a single window.OVERVIEW_DATA object assignment' }
    }

    const statement = statements[0]
    const expression = statement?.type === 'ExpressionStatement' ? statement.expression : undefined
    if (expression?.type !== 'AssignmentExpression' || expression.operator !== '=' || !isOverviewDataMember(expression.left)) {
        return { ok: false, error: 'JavaScript syntax error: expected a single window.OVERVIEW_DATA object assignment' }
    }
    if (expression.right?.type !== 'ObjectExpression') {
        return { ok: false, error: 'JavaScript syntax error: window.OVERVIEW_DATA must be assigned an object literal' }
    }

    try {
        return { ok: true, data: literalValue(expression.right) }
    } catch (error) {
        return { ok: false, error: `JavaScript syntax error: ${error instanceof Error ? error.message : String(error)}` }
    }
}

function literalValue(node) {
    switch (node?.type) {
        case 'ObjectExpression': return objectValue(node)
        case 'ArrayExpression': return arrayValue(node)
        case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return node.value
        case 'NullLiteral': return null
        case 'UnaryExpression': return unaryValue(node)
        default:
            throw new Error(`unsupported literal node ${node?.type ?? '<missing>'}`)
    }
}
```

### B.4 — The hoist in `plans/overview-data.js`

```js
// D:/harness-efforts/codexu/plans/overview-data.js:25-110
const CODEXU_UI = {
    title: 'codexu — plan overview',
    sourcesDescription: 'Sources: ...',
    phaseTreeTitle: 'Codex specialization roadmap — phase-by-phase status',
    phaseTreeIntroHtml: '...',
    legendAreaPills: [...],
    labels: { workstream: {...}, scope: {...}, scopeTitle: {...} },
    copyPreambleHeader: '...',
    copyPreambles: { codexu: '...', codex: '...', 'codexu|codex': '...' },
    staticSections: { parallelism: `...big HTML...`, dependencies: `...big HTML...`, footnote: '...' },
}

// D:/harness-efforts/codexu/plans/overview-data.js:111-115
window.OVERVIEW_DATA = {
  "ui": CODEXU_UI,
  "generatedAt": "2026-05-14T20:00:00Z",
  "generatedFromCommit": "d279d49d",
  "tasks": [ ... 49 task objects ... ],
  ...
}
```

### B.5 — Downstream consumers of `parseOverviewData` / `loadOverviewData`

```
parse-overview-data.mjs (strict — fails)
  ← scripts/lib/sync-core.mjs:823 loadOverviewData
    ← sync-core.mjs:103, :294, :317, :518, :547, :934 (assemble, walk, MCP responses)
    ← scripts/lib/watch-ralph-state.mjs:220 (watcher uses it on every tick)
    ← scripts/lib/load-prds-by-task-id.mjs:23, :133
    ← tools/overview-mcp/.../snapshot-reader.js:73 (every MCP read)
    ← tools/overview-mcp/.../tools/validate-data.js:43

set-override-edit.js parseOverviewDataAssignment (LENIENT — already loops + skips non-assignment statements; would actually tolerate the const)
  ← tools/overview-mcp/.../tools/set-override.js:23
```

So the strict parser is the single bottleneck; the lenient one in `set-override-edit.js` already does the right thing. Note its key difference at `set-override-edit.js:66-79`:

```js
for (const statement of ast.program?.body ?? []) {
    const expression = statement.expression;
    if (expression?.type !== 'AssignmentExpression') continue;
    if (!isOverviewDataMember(expression.left)) continue;
    ...
    return { ok: true, objectExpression: expression.right };
}
```

It doesn't try to evaluate the right-hand side to a JS value — it just hands back the AST node for the `set-override` machinery to splice. The strict parser DOES evaluate to a JS value (which is why it can't tolerate `Identifier` references without resolution).

### B.6 — Tests that pin the strict-parser contract

```
D:/ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/.../validate-data.test.js
```

uses `parseOverviewData` directly, with fixtures that are single-assignment files. Whatever route is chosen, this test suite needs to gain a `const`+`identifier` fixture.

## Hypotheses to verify or refute

Each must be cited with `file:line` evidence. Cap response to 1500 words total.

- **H1.** Option A (inline the const) is the lowest-blast-radius fix. Cite where it touches and confirm no other repo or downstream tool depends on the `CODEXU_UI` const symbol existing as a named binding.

- **H2.** Option B (extend the parser) is preferable long-term because hoisting/sharing data-file constants is a recurring pattern that will reappear in other codexu-style consumer repos. Cite evidence: are there OTHER consumer repos already using or planning the same pattern? Look at `ai-developer-toolkit/plugins/ralph-overview/tools/overview-viewer/CLAUDE.md`, the plugin's CHANGELOG, and any sample/skeleton data files in the plugin tree.

- **H3.** If we pick B, the implementation MUST also update `set-override-edit.js`'s `parseOverviewDataAssignment` and the `set-override` MCP tool (which does an AST splice on the data file) to handle the case where `"ui"` is an identifier reference rather than an inline object. Verify by reading `tools/overview-mcp/.../utils/set-override-edit.js` and listing the lines that would break.

- **H4.** Option C (hybrid: accept const + literal-initializer-only) has identical complexity to full B in practice — once you accept multi-statement programs AND identifier resolution, the "literal only" constraint adds no safety because the literalValue evaluator already throws on unsupported nodes. Verify or refute.

- **H5.** The strict parser exists for a reason — probably to protect against arbitrary JS execution / to prevent the data file from becoming impossible-to-statically-evaluate. Quote the reason from CLAUDE.md or git history; if no documented reason exists, propose the constraint can be safely relaxed.

- **H6.** Even if we extend the parser, the `loadOverviewData` callers (especially the watcher, which re-reads on every debounce tick) need to stay fast. Measure or estimate the perf delta of adding an identifier-resolution pass; under what conditions could this be a hot-path concern?

## Constraints (out of scope — do NOT propose)

- Do not propose moving `CODEXU_UI` to a separate file and importing it — `plans/overview-data.js` is loaded as a `<script>` in the browser via inline injection by Vite (see `tools/overview-viewer/vite.config.ts`). It cannot use ES modules.
- Do not propose replacing the data file with JSON. The data file mixes JS (template literals with embedded HTML for `staticSections.parallelism` / `staticSections.dependencies`) and JSON-shaped data — that's the whole point of the .js extension.
- Do not propose deleting the strict parser entirely — `loadOverviewData` returns a JS data value to consumers; we always need to evaluate to a literal at some point.
- Do not propose adding TypeScript types or refactoring unrelated code.

## Output format

Required structure:

1. **Verification table** — one row per H1–H6 with verdict (confirmed/refuted/partial) and the strongest file:line evidence.
2. **Recommendation** — Option A, B, or C, with one paragraph of reasoning grounded in the verification table.
3. **Files-to-touch list** — for the recommended option, list every file path + estimated line delta, and explicitly call out what tests need to be added.
4. **Things to NOT do** — anti-patterns or seductive shortcuts the team should avoid given the recommendation.

Cap: 1500 words total.

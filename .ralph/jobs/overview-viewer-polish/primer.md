# Pre-iteration context primer (batch 4 — Phase C begins)

## Phases A + B complete
US-001..US-009 PASS (9/19). Bundle: 457 004 B. Headroom to 500 KB ceiling: **42 996 B**.

## Targets for this batch
- **US-010 — Phase C gate.** Install `@radix-ui/react-tooltip` AND install the verification harness (interaction tests). **Choose option (a)**: split-projects vitest config — keep 11 existing SSR tests in `environment: 'node'`, add a new project with `environment: 'jsdom'` + `@testing-library/react` + `@testing-library/user-event` for `src/__tests__/interactions/**/*.test.tsx`. **Do NOT use Playwright / agent-browser** — that tooling is unavailable in this env (PERMANENT). Adding `@testing-library/react` + `@testing-library/user-event` to devDeps will consume ~5–10 KB after tree-shaking (mostly dev-only). Watch the bundle ceiling carefully — runtime additions are only Radix Tooltip (≈ 8–15 KB).
- **US-011** — Radix Dialog replaces KeyboardHelp (deps: US-010).
- **US-012** — Radix Popover + ToggleGroup replaces FilterChips (deps: US-011).

## Bundle ceiling — HARD STOP
If `plans/overview.html` crosses 500 KB after any iteration in this batch, the iteration agent MUST emit `<ralph-meta>{"status":"blocked","error_code":"bundle_exceeded"}` rather than continuing. Halt Phase C and surface the issue.

## US-010 acceptance reminders
The `criteriaWarnings` entry on US-010 explicitly recommends option (a). The pnpm-lock.yaml at the repo root must be regenerated when adding the new dependency. Verify with `pnpm install --frozen-lockfile` after the lockfile is updated.

## Tooltip CSS z-index gotcha
`.kbd-help` has `z-index: 100` at `styles.css:592`. The Radix Tooltip portal content's z-index MUST be ≥ 100 so it renders above existing surfaces.

## Carry-forward
- Browser automation unavailable (PERMANENT). The new jsdom harness IS the verification path for US-011..US-014 + US-018.
- 3 baseline-9f81c1f8 deviations preserved.
- Codex manifest schema mismatch is advisory-only.

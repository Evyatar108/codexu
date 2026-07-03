# Happy Patch Surface vs Upstream (slopus/happy)

**Last Updated**: 2026-06-30
**Import baseline (inferred)**: `cli-1.1.8` @ `b72fd8111a43395e9991cfbdabba36f5a3285e5e` (upstream `slopus/happy`, 2026-04-27) — see [§6 Baseline record](#6-baseline-record).
**Latest upstream release (forward target)**: `cli-1.1.10` @ `71c417e1092e73cf34eb24f9601d569394c1f359` (2026-06-23).

> Sibling reference: [`codex/docs/implementation/patch-surface.md`](../codex/docs/implementation/patch-surface.md) — the mature model this catalogue mirrors (marker discipline, invariant-to-guard table, replant notes). Read its §14/§15 before adding a row here.

This is the authoritative reference for the **strategically-significant** changes the fork carries on
top of upstream `slopus/happy`. It is deliberately **not** a per-file diff of all ~359 modified files —
markers add diff noise, so they are reserved for the must-survive fork edits and the deliberate
deletions that a naive upstream merge would silently regress. Consult (and update) this document when:

- **Importing a newer upstream** (`cli-1.1.10` and beyond): every KEEP/RESTORE row is a hunk a
  take-upstream merge would revert; every KEEP-DELETED row is a construct a take-upstream merge would
  resurrect. Walk the table before resolving conflicts.
- **Auditing for a fork regression**: if fork behavior broke after a sync, a row here names the guard
  (spec/typecheck) that should have caught it.
- **Onboarding**: the buckets below explain *why* the fork diverges where it does.

Unless a row says otherwise, server paths are relative to `packages/happy-server/sources/`, CLI paths
to `packages/happy-cli/src/`, and app paths to `packages/happy-app/sources/`.

---

## 1. Marker convention

Strategically-significant fork hunks in **upstream-canonical files** carry an in-code marker so the
next importer can find them by grep, not by memory. The canonical form is:

```
// FORK PATCH: [KEEP|KEEP-DELETED|RESTORE] <short reason> (invariant <ID>)
```

Language/context variants (same tokens, comment syntax adapted):

| Context | Marker form |
|---|---|
| TS / JS (`.ts`, `.tsx` non-JSX position) | `// FORK PATCH: [BUCKET] <reason> (invariant <ID>)` |
| JSX (inside markup) | `{/* FORK PATCH: [BUCKET] <reason> (invariant <ID>) */}` |
| Prisma schema (`.prisma`) | `// FORK PATCH: [BUCKET] <reason> (invariant <ID>)` |

Rules:

- **Markers are comment-only.** Adding/removing a marker never changes behavior. (This whole milestone,
  M0, is markers + docs + `.gitattributes` — zero behavior change.)
- **One marker per hunk, at the hunk's anchor** (the function/branch/statement it guards), not on every
  line. For a file the fork has largely rewritten (e.g. the R4 CLI wiring files), place **one
  representative marker at the entry point** and let this catalogue carry the detail — dozens of
  per-line markers would recreate the diff noise the convention exists to avoid.
- **Every marker cites its catalogue invariant `<ID>`.** The ID scheme is package-scoped:
  - `HS-<n>` — happy-**s**erver
  - `HC-<n>` — happy-**c**li
  - `HA-<n>` — happy-**a**pp
- **KEEP-DELETED rows have no marker** (there is no line to mark — the code is *gone*). Their guard is a
  "must-not-exist" test; the catalogue row is the only durable record.
- **Line numbers are hints only.** They drift. The `file:symbol` anchor + the marker text are the
  durable locators; re-grep the marker after any import.

## 2. Buckets

| Bucket | Meaning | Merge hazard if lost | Marker? |
|---|---|---|---|
| **KEEP** | A fork modification to an upstream-canonical file whose *current form must survive* an upstream import. | Take-upstream silently **reverts fork behavior**. | Yes — on the hunk. |
| **KEEP-DELETED** | An upstream construct (route, model field, symbol) the fork **deliberately removed** and that must **stay removed**. | Take-upstream silently **resurrects** the deleted construct. | No (nothing to mark) — guard is a negative "must-not-exist" test. |
| **RESTORE** | A KEEP hunk that milestone **M1 (seam relocations R1–R4)** will move behind a fork seam/overlay to shrink the conflict surface. Until M1 lands it behaves exactly like KEEP. | Same as KEEP; additionally, the marker names the target relocation (`RESTORE-R<n>`) so M1 has a labeled anchor. | Yes — with the `RESTORE-R<n>` tag. |

> **M0 scope note.** This milestone (M0) only *annotates* the RESTORE hunks; it does **not** relocate
> them. The actual seam relocations R1–R4 are milestone **M1** and are explicitly out of scope here.
> See [`.ralph/jobs/happy-upstream-conflict-surface-and-merge-strategy/plan.md`](../.ralph/jobs/happy-upstream-conflict-surface-and-merge-strategy/plan.md) §5.

---

## 3. happy-server invariants (`HS-*`)

Paths relative to `packages/happy-server/sources/` unless noted. The fork's server is a **single-user,
self-hosted** server with an opt-in **public mode** (default-off) — the multi-tenant SaaS shape from
upstream is deliberately collapsed. See [`packages/happy-server/AGENTS.md`](../packages/happy-server/AGENTS.md).

| # | file:symbol (line hint) | bucket | invariant — why it must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
<!-- M0-S4: happy-server rows -->

## 4. happy-cli invariants (`HC-*`)

Paths relative to `packages/happy-cli/src/` unless noted. See [`packages/happy-cli/AGENTS.md`](../packages/happy-cli/AGENTS.md).

| # | file:symbol (line hint) | bucket | invariant — why it must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
<!-- M0-S5: happy-cli rows -->

### Zero-conflict overlay directories (context only — NO markers)

<!-- M0-S5: overlay context rows -->

## 5. happy-app inventory (`HA-*`)

Paths relative to `packages/happy-app/sources/` unless noted. See [`packages/happy-app/AGENTS.md`](../packages/happy-app/AGENTS.md).

> **Doc-only in M0.** The app hotspots below are the durable **manual three-way-merge cost centers**
> (large fork-rewritten files that conflict on nearly every import). M0 does **not** add source markers
> to them — the marker ROI is low on files that are already ~entirely fork-owned, and the merge is
> manual regardless. They are catalogued here so the importer knows to budget three-way-merge time,
> and so M2+ relocations (R5/R6/R8) have a starting inventory.

| # | file:symbol | bucket | invariant — why it conflicts / must survive | marker? | test / guard | replant note |
|---|---|---|---|---|---|---|
<!-- M0-S6: happy-app rows -->

---

## 6. Baseline record

<!-- M0-S2: baseline pin -->

## 7. `.gitattributes` merge policy

<!-- M0-S3: gitattributes policy + i18n dedupe finding -->

## 8. Replant notes

Per-surface prose on *how* to re-apply the RESTORE hunks when their file has moved or been rewritten
upstream. (KEEP hunks that are stable enough to re-anchor by grep alone do not need a note.)

<!-- M0-S4/S5: replant notes -->

---

## 9. Ownership & cadence

- **Owner**: the operator / whoever drives the next upstream import.
- **Cadence**: re-validate this catalogue on **every upstream import** (each `cli-*` bump). For each
  row: confirm the marker still grep-matches, the guard still passes, and the `file:symbol` anchor
  still exists. Re-tree-match the [§6 baseline](#6-baseline-record) if the import advances it.
- **When adding a row**: prefer the smallest-possible conflict surface first (overlay/seam placement,
  per the RESTORE bucket) before committing a new permanent inline KEEP. Mirror the codex tenant in
  [`codex/docs/implementation/patch-surface.md`](../codex/docs/implementation/patch-surface.md) §14.
- **Audit helper**: [`scripts/audit-happy-fork-patches.mjs`](../scripts/audit-happy-fork-patches.mjs)
  cross-checks the in-code markers against this catalogue (advisory). <!-- M0-S7: adjust if deferred -->

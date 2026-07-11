# Phase-4 Plan Review: subagent-model-routing-policy-parity-v1.1

Grounded against `ai-developer-toolkit` commit
`964c36f700fef553e17b3a09c11a0bde7711fe38`.

## Summary

- Critical: 0
- High: 0
- Medium: 3

The routing policy and standalone-plugin boundaries are substantially correct,
but the story graph, exact-snapshot portability, and release documentation need
correction before implementation.

## Findings

### F-001 — Medium — Story dependency inversion

US-003 requires the test suite to assert all five `1.1.0` stamps and pass, but
US-005 owns those version changes and depends on US-003. US-003 therefore cannot
satisfy its own acceptance criteria in dependency order unless implementation
leaks US-005 work into an earlier story.

**Evidence:** `stories-outline.md:62-87` assigns the five-stamp assertion and
passing test to US-003; `stories-outline.md:119-145` assigns the actual manifest
and marketplace bumps to US-005 while declaring dependencies on US-003 and
US-004.

**Recommended fix:** Reorder the metadata story before the exact-version gate,
merge the two stories, or move the `1.1.0` assertions and final full-suite pass
into US-005. Keep every story independently satisfiable in declared dependency
order.

### F-002 — Medium — Exact text fixtures lack an LF checkout contract

The plan adds `.txt` guidance fixtures and requires raw byte-for-byte comparison,
but it does not include a line-ending rule for those files. The exact reference
commit has no applicable `.gitattributes` rule for the proposed fixture paths.
On a checkout using CRLF conversion, authored fixtures can differ from the
runtime strings' `\n` bytes and fail despite identical policy text.

**Evidence:** `plan.md:150-154`, `plan.md:199-202`, and `plan.md:324-326`
require authored `.txt` fixtures and byte-exact checks.
`ai-developer-toolkit/.gitattributes:1` only pins `.gitattributes` itself; no
rule covers `plugins/subagent-model-routing/tests/fixtures/*.txt`.

**Recommended fix:** Add the directly related root `.gitattributes` change
`plugins/subagent-model-routing/tests/fixtures/*.txt text eol=lf` to the file
list and acceptance criteria, or choose an authored fixture format whose bytes
cannot be checkout-converted. Preserve raw comparison rather than normalizing
away byte drift.

### F-003 — Medium — Shipped release guidance would remain contradictory

The plan correctly identifies that the generic release skill assumes a
nonexistent Claude manifest, yet it limits the root `AGENTS.md` edit to the
plugin summary bullet. At the exact reference commit, the auto-loaded root
release instructions still tell maintainers that every version bump uses
`.claude-plugin/plugin.json` and the universal four-file release skill. That
would remain in direct conflict with this plugin's two manifests plus three
marketplace stamps.

**Evidence:** `plan.md:63-67`, `plan.md:183-192`, and `plan.md:500-502`
acknowledge the exception but exclude the release guidance from modification.
At commit `964c36f`, `ai-developer-toolkit/AGENTS.md:60` mandates a Claude
manifest bump and `AGENTS.md:69` says to use the four-file release skill for
plugin releases.

**Recommended fix:** Keep the generic skill implementation out of scope, but
add a narrow `subagent-model-routing` exception to the root marketplace/release
guidance: use the manual five-stamp path, do not add a Claude manifest, and do
not invoke the incompatible release skill. Include this root-doc edit in
US-004/US-005 acceptance criteria.

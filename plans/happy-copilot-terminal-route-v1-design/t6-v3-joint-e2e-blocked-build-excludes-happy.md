# T6 v3 joint E2E — BLOCKED: published artifact excludes the Happy feature

**Date:** 2026-08-18. **Happy client:** `main@d1a5abcc` (ready, unchanged).
**Verdict:** the E2E checklist cannot start. Artifact
`20260818T052345Z-261f353ce38a` ships with the Happy embed path
**compiled out**: both gates are dead-coded in the bundle, the native runtime
exports none of the Happy listener functions, and a live launch with
`COPILOT_HAPPY_EMBED=1` produced no registry entry and no Happy log line.
Checklist result: 0 of 6 phases executed — blocked at phase 1 (discovery).

## What we verified before launching (all PASSED)

| Check | Result |
|---|---|
| Artifact synced via OneDrive channel `local-preview` | `20260818T052345Z-261f353ce38a`, edition `1.0.80-snapshot.8b7741.1` — matches the fork's build identity |
| Runtime SHA-256 | `94E263C701837C6A8824CD396E914B4980F088472B5AAE1089ED496B7C4BC2F3` — **exact match** with the fork's stated hash, re-verified after copy into the local cache |
| Manifest capability list | includes `private-happy-t6` and `t6-happy-copilot-embedded-ui-server-remote-steering`; composition row `261f353ce38a…` = "Merge owner-only private Happy T6 steering and feature wiring" |

So the *intended* composition is right — the manifest says T6 is in. The
payload disagrees.

## Evidence the payload excludes Happy

**1. Dead-coded embed capture** — `runInteractiveMode` in
`payload/dist-cli/app.js` (line 404769-404776):

```js
let happyEmbedCapture = { enabled: false };
let startHappyListenerDegraded2;
if (false) {                        // <-- build-time exclusion
  const happyEmbed = await null;    // <-- module import elided
  const { captureHappyEmbed: captureHappyEmbed2 } = happyEmbed;
  ...
}
```

`COPILOT_HAPPY_EMBED=1` is therefore never read; `isHappyEnabled()` is
permanently false.

**2. Dead-coded listener start** — `EmbeddedServer.startHappyListener`
(app.js line 104462-104465):

```js
async startHappyListener() {
  if (true) {
    throw new Error("Happy listener is excluded from this build.");
  }
```

That literal string — "Happy listener is excluded from this build." — is the
build system's own exclusion marker.

**3. Native runtime lacks the seam.** Binary string scan of
`prebuilds/win32-x64/runtime.node` (the hash-verified one):
`startHappyTcpListener`, `stopHappyTcpListener`, `happyControlCommand`,
`happySetPolicyAllowed` — **all absent** (ASCII and UTF-16). Only the
registry serializer's `privateProfile` field name is present. Even if the JS
gates were open, `startHappyTcpListener` would throw
`private-happy-t6 runtime feature is not available` (app.js line 40254).

**4. Live launch confirms.** Ran the artifact from the local cache in a
controllable PTY with `COPILOT_HAPPY_EMBED=1` (same harness as the ev.6 E2E):
process started normally (log `process-1787069625700-392.log`), zero
`happy`/`listener` log lines, no new file in `~/.copilot/servers` after
several minutes. (The launch also surfaced an unrelated-looking
`TerminalRenderer React uncaught error: TypeError: Cannot read properties of
null (reading 'kind')` in the TUI — flagged for the fork's awareness, not
investigated further since the build is unusable for T6 anyway.)

## Interpretation

This looks like the publish pipeline's owner/private-feature stripping
(`payloadLabel: "unsigned-owner-only"` exclusion list) removed the
`private-happy-t6` feature from the payload even though the composition
merged it and the manifest advertises it. The `if (false)` / `if (true)
throw` shapes are bundler constant-folding of a build-time feature flag that
evaluated to OFF during payload assembly.

## Ask for the fork agent

1. Re-publish the artifact with the `private-happy-t6` build flag ON in the
   payload assembly step — the manifest capability row alone is not enough.
2. Sanity-check before announcing: the published `app.js` must NOT contain
   the string "Happy listener is excluded from this build.", and
   `runtime.node` must export `startHappyTcpListener`.
3. State whether the *runtime hash will change* (it must, if the Rust seam is
   compiled in) so we can re-verify identity on our side.

## Happy side status

Unchanged and ready: `main@d1a5abcc`, harness in place, checklist prepared.
The moment a corrected artifact lands on the channel we re-run from phase 1.

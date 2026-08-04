# Happy CLI over OneDrive — EvCopilot launcher integration (Opus lens)

**Lens:** Claude Opus 5 (independent; sibling lens = GPT-5.6 Sol)
**Date:** 2026-08-04
**Scope:** design recommendation only. Read-only investigation; no code written.
**Sources read:** `C:\efforts\copilot-runtime-workspace\scripts\*`, the *published*
module at `C:\Users\evmitran\OneDrive - Microsoft\Apps\EvCopilot\module\EvCopilot.psm1`,
the OneDrive channel/version/proxy layout, `C:\efforts\codexu\packages\happy-cli\**`,
`C:\efforts\codexu\docs\copilot-cli-integration.md`, live on-disk state
(`%LOCALAPPDATA%\EvCopilot`, `~/.copilot/servers`, `~/.happy`).

---

## Executive summary

1. **The design is not greenfield — the consumer side is already merged.** `launchContext.ts`
   implements the full release-set / manifest / receipt / capability contract
   (`launchContext.ts:38-166`, `:344-522`). This is a *producer* problem, not a design problem.
2. **Blocking bug found:** the Happy artifact builder emits `compatibility.evCopilot: []`
   (`portable-artifact.cjs:1635`) while the consumer schema demands `.min(1)`
   (`launchContext.ts:154`). Every artifact built today is rejected by Happy itself.
3. **Recommended fix is to DELETE that check, not populate it** — the release-set record
   (`launchContext.ts:492-499`) already binds both artifacts, and keeping the in-manifest
   allowlist forces a 220 MB Happy rebuild per ev-copilot publish.
4. **Divergence bomb:** the repo's `scripts/EvCopilot.psm1` (818 lines) is *not* the module
   in production (1146 lines, 17 extra functions, **zero** `happy` references). Publishing
   from the repo would silently delete settings-sync and proxy-autostart on all machines.
5. **Payload = the existing 220 MB `happy-win32-x64.zip`** (bundled node + `pnpm deploy --prod`
   tree). Ship the zip, not the expanded tree — OneDrive cannot sync ~30k small files sanely.
6. **Auto-attach belongs in the launcher**, using the exact `Win32_Process` parent-PID technique
   already proven in `Find-EvCopilotManagedProxyProcess` (`:560-584`). Zero fork/Happy changes.
7. **Do not add `happy daemon start` to the launcher** — `copilotCommand.ts:85` already does it.
8. **Daemon-identity collision is real:** a payload-bound Happy and the operator's global npm
   Happy will evict each other's daemons. Fix by retiring the global install, not by moving `HAPPY_HOME_DIR`.
9. **Terminal launch must never be gated on Happy; routing decisions must be fail-closed.**
10. Phase 1 is ~1 launcher publish script + 1 launcher route block + 1 small codexu schema relaxation.

---

## Disconfirming findings (read first — these contradict the brief)

### D1. The repo's `EvCopilot.psm1` is NOT the module running in production

| | repo `scripts/EvCopilot.psm1` | published `module/EvCopilot.psm1` |
|---|---|---|
| lines | 818 | 1146 |
| SHA-256 | `D6798D65…238F` | `E7B39B4C…C1B0` |
| mtime (UTC) | 2026-07-23 05:25 | 2026-08-03 19:54 |
| functions | 35 | 50 |
| `happy` references | 11 (`:361-368`, `:403-436`) | **0** |
| config schemaVersion written | 2 (`:470`) | 1 (`:762`) |

17 functions exist **only** in the published module: `Sync-EvCopilotSettings*`,
`Push-EvCopilotSettings`, `Merge-EvCopilotPortableSettings`, `Get-EvCopilotPortableSettingsDocument`,
`Write-EvCopilotProxyPrereqs`, `Get-EvCopilotProxyProcessStatePath`, `Read/Write-EvCopilotProxyProcessState`,
`Find-EvCopilotManagedProxyProcess`, `Get-EvCopilotProxyAutostartMode`, `Get-EvCopilotDotnetScriptArguments`,
`Test-EvCopilotActiveCapability`, `Write-EvCopilotProvidersCompatibilityProjection`,
`Get-EvCopilotSettingsCanonicalPath`, `Assert-EvCopilotPortableSettingsDocument`, `Write-EvCopilotJsonAtomic`.

Two functions exist only in the repo: `New-EvCopilotConfig`, `Initialize-EvCopilotConfigV2` — i.e.
**the entire `happy` config block the brief describes as "reserved scaffolding" is not deployed anywhere.**

`git log --all -S "Sync-EvCopilotSettingsAuto" -- scripts/EvCopilot.psm1` returns **nothing** —
no commit in this repository, on any branch including `origin/main`, ever contained the
production lineage. `origin/main`'s copy is 684 lines.

`Publish-EvCopilot.ps1:386` copies `$workspaceRoot\scripts\EvCopilot.psm1` verbatim into
`<OneDrive>\module\`. The published module therefore came from a **different workspace clone**
(another machine, unpushed). Because `Install-EvCopilotProfile.ps1` installs a *self-healing
hot-reload* wrapper that re-imports the module whenever its mtime advances, a bad publish
propagates into already-open shells within one command.

**Consequence:** any Happy work implemented against `C:\efforts\copilot-runtime-workspace\scripts\EvCopilot.psm1`
and published with `Publish-EvCopilot.ps1` will **silently delete settings sync, proxy process-state
tracking, proxy autostart mode, and `doctor` proxy diagnostics from every machine, instantly.**
This is Phase 0 and it is non-negotiable.

**Live evidence the two lineages both touched this box:** `%LOCALAPPDATA%\EvCopilot\config.json`
currently reads `"schemaVersion": 1` *and* carries a full `happy` block. The published module's
`Get-EvCopilotConfig` (`:736-756`) round-trips unknown properties and `Save-EvCopilotConfig`
(`:762`) stamps `schemaVersion = 1`; the repo module (`:438-445`, `:470`) stamps `2`. The file is
oscillating between the two writers.

### D2. `compatibility.evCopilot: []` — the artifact builder produces manifests Happy rejects

`portable-artifact.cjs:1633-1642` emits:

```js
compatibility: {
    launcherSchemaVersions: [1],
    evCopilot: [],                                   // <-- always empty
    controller: { registrySchema: 2, protocolVersion: 3, copilotPackageVersions: ['1.0.71-3'] }
},
capabilities: ['copilot-terminal-route-v1'],
```

`launchContext.ts:150-154` declares `evCopilot: z.array(...).strict()).min(1)`. An empty array
fails `happyArtifactManifestSchema` outright → `LaunchContextError('invalid-happy-payload-manifest')`
at `launchContext.ts:446-455`. Even if it parsed, `compatibleRuntime` at `:461-465` would be `false`
→ `release-set-incompatible` at `:470`.

**No Happy artifact currently buildable can be routed.** This is the single concrete blocker.

### D3. The ev-copilot manifest is schemaVersion 1; Happy demands schemaVersion 2 with a `copilot` block

`launchContext.ts:92-111` requires `schemaVersion: z.literal(2)` plus a strict
`copilot: { packageVersion, nodeVersion, executable: 'payload/node.exe', fixedArguments: ['payload/dist-cli/index.js'] }`.

The live manifest for `20260803T224827Z-a9b8d71f5850` has `schemaVersion: 1` and top-level keys
`schemaVersion, artifactId, version, channel, payloadLabel, warning, edition, upstreamVersion,
threatModel, platform, publishedAtUtc, source, capabilities, exclusions, nodeVersion,
runtimeSha256, autoUpdateDisabled, localBuildMarker, signatureMode, files` — **no `copilot` block.**

Good news: bumping it is backward-compatible. `Test-EvCopilotPackage` (published `:805-833`) and
`Test-EvCopilotPayload` (`:768-803`) never inspect `manifest.schemaVersion`; they check labels,
identity, edition/upstream cross-binding, and the closed-world file inventory. Adding
`schemaVersion: 2` + a `copilot` block is purely additive for the deployed launcher.

### D4. The runtime version handshake is tautological — it is NOT a compatibility gate

`nativeLocalRpcClient.ts:173-178` checks `connected.version !== expectedVersion`. But
`runCopilotMirror.ts:355` supplies `registry.copilotVersion` as `expectedVersion`:

```ts
await native.connect(registry.token, registry.sessionId, registry.copilotVersion);
```

Both sides of that comparison originate from the **same ev-copilot process**. It detects only
a registry file that outlived its writer onto a reused PID. It provides **zero** protection against
happy↔fork drift. The brief's option "runtime handshake only — is that enough?" is answered: **no.**

Confirmed by live data: `~/.copilot/servers/22508.json` (the T6 ui-server entry, 2026-08-02)
carries `"copilotVersion": "0.0.1"` — the upstream placeholder — while the five older
`schemaVersion: 2` managed-server entries carry the real `"1.0.71-3"`.

`COPILOT_PROTOCOL_VERSION = 3` and `COPILOT_NATIVE_VERSION = '1.0.71-3'` (`types.ts:7-8`) are
compile-time constants in Happy, and `nativeLocalRpcClient.ts:169` sends `String(...)` for
`protocolVersion` while comparing the response as a number at `:173` — the string/number
asymmetry the brief mentions is real and is load-bearing (do not "clean it up").

### D5. `Invoke-EvCopilot` runs the terminal **synchronously in the foreground**

`published :1121`: `& $node "--max-old-space-size=$m" $entry @Arguments`. There is no
`Start-Process`, no `-PassThru`, no PID. Everything the launcher wants to do "after launching the
terminal" must actually happen **before** line 1121 or in a background job. This invalidates the
naive reading of Q4 option (a).

### D6. The daemon is already ensured by `happy copilot` — and the docs are stale

`copilotCommand.ts:85` calls `ensureDaemonRunning({ requireIdleForReplacement: launchContext !== undefined })`
before `runCopilotMirror`. The launcher must not duplicate this.

`docs/copilot-cli-integration.md:1213-1218` states "The interactive route is **not active on any PC**…
The Copilot fork seam … remain outstanding." That is stale: ev-copilot `1.0.76-ev.12` ships
capability `t6-happy-copilot-embedded-ui-server-remote-steering` (manifest `capabilities[]`), and
a live `schemaVersion: 1` ui-server entry exists from 2026-08-02. The *fork seam is shipped*;
only the delivery half is missing. Fix the doc in Phase 1.

### D7. Nothing has ever been published or cached

- `<OneDrive>\Apps\EvCopilot\happy` — **does not exist**.
- `%LOCALAPPDATA%\EvCopilot\` contains only `proxy/`, `staging/`, `versions/`, `config.json` —
  no `run/`, no `happy/`.
- `~/.happy/daemon.state.json` has `startedWithCliVersion: "1.1.8-evy.11"` and **no**
  `startedWithPayloadArtifactId` — the running daemon is the global npm install
  (`C:\.tools\.npm-global\happy.ps1`), i.e. an *absent-payload* identity.

### D8. Payload size premise correction

The ev-copilot payload is **110 files / 329,707,172 bytes ≈ 314 MiB**, not ~1 GB. It is
file-sparse (one 18 MB `app.js` + a ~100 MB `node.exe`). The Happy `pnpm deploy --prod` tree is
the opposite shape — this asymmetry drives the Q2 recommendation.

### D9. Six stale registry entries already exist on this box

`~/.copilot/servers/` holds entries from 2026-07-18/19 and 2026-08-02 whose processes are long
dead. The failure mode is already live. It is *contained* by `uiServerRegistry.ts:152-158`
(5-minute mtime staleness + `process.kill(pid,0)` liveness) — but note that a **stale file whose
PID was reused by an unrelated live process** passes both checks. Mitigated in practice by the
token check on `connect`.

---

## Q1 — Release-set semantics

**Recommendation.**
A *release set* is an immutable, monotonically sequenced triple published as one OneDrive file:

```
<OneDrive>\Apps\EvCopilot\happy\release-sets\<releaseSetId>.json
{
  "schemaVersion": 1,
  "releaseSetId": "20260805T101500Z-rs01",
  "sequence": 7,
  "channelPointerSha256": "<SHA of happy/channels/local-preview.json at publish>",
  "evCopilot": { "artifactId": "...", "manifestSha256": "...", "copilotPackageVersion": "1.0.71-3" },
  "happy":     { "artifactId": "...", "manifestSha256": "..." },
  "cachedAtUtc": "..."
}
```

This shape is **not invented here** — it is verbatim `cachedReleaseSetSchema`
(`launchContext.ts:75-90`), which Happy already cross-checks field-by-field at `:492-499`.
Publish it to OneDrive and copy it to `%LOCALAPPDATA%\EvCopilot\happy\release-sets\<id>.json`,
which is exactly where `launchContext.ts:475-481` looks.

**It pins an exact ev-copilot artifact, not a range.** The consumer's matching is set membership
on `{artifactId, manifestSha256, copilotPackageVersion}` (`:461-465`, `:492-495`), so ranges are
not expressible and should not be faked.

**Resolution when the pinned ev-copilot and the available release sets disagree — ev-copilot pin is sovereign:**

```
active ev-copilot artifact  := existing logic (pinnedVersion ?? currentVersion)   [published :935-968]
candidate release sets      := all cached/available sets where evCopilot.artifactId == active
if happy.pinnedReleaseSetId is set and it is a candidate  -> use it
elif candidates non-empty                                 -> use highest sequence
else                                                      -> DO NOT ROUTE; launch normally
```

Never downgrade, upgrade, or re-pin ev-copilot to satisfy Happy. The runtime the operator selected
is what runs.

**Fail-closed vs fail-open — both, on different axes.** This is the key insight:

| axis | policy |
|---|---|
| launching the terminal | **fail-open, always.** Nothing about Happy may prevent `& $node …` at `:1121`. |
| deciding to route | **fail-closed.** Any missing/mismatched/unverified input ⇒ no route, one warning line, continue. |

This is the same posture the launcher already takes for its own runtime
(`Get-EvCopilotActiveVersion:951-959` keeps a verified cache when OneDrive is unreachable) and for
the proxy (`Ensure-EvCopilotProxy` warns, never throws).

**`highestSeenSequence` semantics.**
- `sequence` is `z.number().int().positive()` (`launchContext.ts:78`), so ≥ 1; the default
  `highestSeenSequence: 0` (repo `:416`) correctly means "never seen one".
- On reading the happy channel pointer: `sequence < highestSeenSequence` ⇒ **refuse the pointer**,
  warn once, keep `currentReleaseSetId`. This is anti-rollback against a stale/reverted OneDrive
  replica — the realistic threat given cross-machine sync lag, not a malicious writer
  (the published threat model is explicit: *"no protection against a malicious OneDrive writer"*).
- `sequence == highestSeenSequence` with a matching id ⇒ idempotent no-op (normal steady state).
- `sequence > highestSeenSequence` ⇒ install, then raise `highestSeenSequence`.
- **Operator rollback (`ev-copilot happy rollback`) never lowers `highestSeenSequence`.** It moves
  `currentReleaseSetId := previousReleaseSetId` and sets `pinnedReleaseSetId`, exactly mirroring
  the runtime `rollback` verb (`published :1077-1089`). The sequence gate is about untrusted input;
  a local operator action is trusted.

**Rejected alternatives.**
- *Fail-closed on the terminal launch (refuse to start copilot if Happy is unroutable).* Rejected:
  violates the stated hard requirement; also makes a OneDrive outage a total work stoppage.
- *SemVer range (`compatibleEditions: ">=1.0.76-ev.10 <1.0.77"`).* Rejected: `editionVersion` is
  not reliably monotonic across composition rebuilds (the manifest carries a 48-entry `capabilities`
  list precisely because the version string is not descriptive), and the consumer's checks are
  hash-exact anyway.
- *Timestamp/mtime ordering instead of an explicit sequence.* Rejected: OneDrive rewrites mtimes on
  sync; `sequence` is already in the merged schema.

**Risks.** Two machines publishing concurrently can mint the same `sequence`. Mitigate by deriving
`sequence` as `max(existing sequences in release-sets/) + 1` under a publish-time
`.publishing-<guid>` marker directory, mirroring the existing `versions\.publishing-*` convention
(`published :921` filters those out of `Show-EvCopilotVersions`).

---

## Q2 — Payload shape

**Recommendation: (a) hermetic — bundled `node.exe` + a `pnpm deploy --prod` tree — shipped as the
single existing `happy-win32-x64.zip`, expanded on the target machine into
`%LOCALAPPDATA%\EvCopilot\happy\versions\<artifactId>\payload\`.**

This is already built and hardened. `portable-artifact.cjs` performs:
- immutable git snapshot + `assertCleanSource`/`assertSourceUnchanged` (`:1398`, `:1562`, `:1674`)
- `pnpm install --frozen-lockfile --filter happy...` then builds `@slopus/happy-wire`,
  `happy-server`, `happy` (`:1438-1452`)
- `pnpm --filter happy deploy --prod --legacy` (`:1459-1470`) → a self-contained tree
- pinned Node `v22.23.1` with a hard-coded distribution SHA-256 (`:20-23`)
- forbidden-content + machine-metadata scans, SPDX SBOM, license inventory, reproducible zip
  metadata, and an **isolated payload-only smoke test outside the repo** (`:1264-1374`,
  evidence `:1585-1600`)
- entrypoints `payload/node.exe` + `payload/happy/dist/index.mjs` (`:1628-1631`), which is exactly
  what `launchContext.ts:424-434` demands.

**Why not (b) dist-only + machine Node.** `happy-cli` depends on the `happy-server` workspace
package (which carries a **Prisma client**, generated at `:809` `generateDeployedPrismaClient`) and
on native-ish deps. `pnpm build` produces `dist/*.mjs` via pkgroll but does **not** inline the
workspace/runtime dependency graph — that is why the builder runs `pnpm deploy` rather than
shipping `dist/`. Requiring a machine Node also reintroduces the exact class of drift
(`node --version`, ABI, PATH) that the hermetic ev-copilot payload was built to eliminate.

**Why not (c) npm-pack + install step.** An install step is (i) non-atomic — the whole point of the
`staging → verify → Move-Item` pattern (`published :874-899`); (ii) network-dependent, defeating
"OneDrive is asynchronous transport, not a launch dependency"; (iii) it would write npm bin shims
(`happy.ps1`) into a global prefix, which is precisely the conflict source identified in Q5.

**Ship the ZIP, not the expanded tree — this is a deliberate divergence from the ev-copilot precedent.**
The ev-copilot payload is 110 files (D8) and expands fine on OneDrive. A `pnpm deploy --prod` tree
is tens of thousands of small files. OneDrive's per-file sync makes that pathologically slow and
maximises partial-sync exposure. The Happy manifest already anticipates this: it carries an
`archive: { name: 'happy-win32-x64.zip', sha256, length, fileCount, expandedLength }` block
(`launchContext.ts:132-138`) which the ev-copilot manifest has no analogue for, plus a `files[]`
inventory of the **expanded** payload (`:143-147`) for post-extraction verification. The safe
extractor and zip-path guard already exist (`portable-artifact.cjs:1143-1204`).

So the OneDrive layout is:

```
<OneDrive>\Apps\EvCopilot\happy\
  channels\local-preview.json            # {schemaVersion, channel, payloadLabel, releaseSetId,
                                         #  sequence, happyArtifactId, happyManifestSha256,
                                         #  evCopilotArtifactId, updatedAtUtc}
  release-sets\<releaseSetId>.json       # cachedReleaseSetSchema shape
  versions\<happyArtifactId>\
    happy-win32-x64.zip                  # ~220 MB, one file
    manifest.json                        # happyArtifactManifestSchema
    COMPLETE.json                        # {…, manifestSha256, archiveSha256}
    sbom.spdx.json  licenses.json  build-report.json
```

and the local cache mirrors `launchContext.ts`'s expectations:

```
%LOCALAPPDATA%\EvCopilot\
  happy\versions\<happyArtifactId>\{payload\…, manifest.json, COMPLETE.json, receipt.json}
  happy\release-sets\<releaseSetId>.json
  run\<invocationId>\{launch-context.json, happy-status.json}
```

**npm bin shims / `happy.ps1`:** not needed and not wanted. The launcher invokes
`payload\node.exe payload\happy\dist\index.mjs copilot …` directly — and it *must*, because
`launchContext.ts:431-434` compares `process.argv[1]` against the exact expected entrypoint path
and throws `happy-payload-entrypoint-mismatch` otherwise. A shim would break validation.

**Risks.**
- ~220 MB per Happy artifact + ~314 MiB per ev-copilot artifact. There are already **36**
  ev-copilot version directories in OneDrive (≈ 11 GB). Retention policy is now urgent
  (see Q6/Q7) — Happy will make it worse faster.
- Two pinned Node runtimes on disk (Happy `v22.23.1`, ev-copilot `v24.18.0`). **Do not dedupe.**
  Independent pins are the hermeticity guarantee; sharing would couple two release trains.
- Cold-start cost is one ~220 MB OneDrive hydration + one unzip. Both happen once per artifact and
  must run **in the background / not on the critical path** of the first launch (see Q7).

---

## Q3 — Compatibility contract

**Recommendation: bind at *publish* time in the release-set record; make a small surgical change in
codexu to stop requiring the redundant in-manifest allowlist.**

Concretely, keep these three checks (all already implemented, all correct):

| check | site | when known |
|---|---|---|
| `compatibility.controller.{registrySchema, protocolVersion, copilotPackageVersions}` | `launchContext.ts:155-159`, `:466-469` | **build time** (from `types.ts:7-9`) — correct as-is |
| `capabilities.includes('copilot-terminal-route-v1')` | `:472-474` | build time — correct as-is |
| release-set cross-binding of both artifact tuples | `:492-499` | **publish time** — the right layer |

and **relax `compatibility.evCopilot`** (`:150-154`, `:461-471`) from a required non-empty allowlist
to optional/possibly-empty, treating empty as "unbound; the release-set record is authoritative".

**Rationale.** The in-manifest allowlist requires the Happy build to know, at build time, which
ev-copilot artifacts it will ever pair with. That is impossible (ev-copilot publishes far more often —
32 artifacts vs 0 Happy artifacts to date) and forces one of three bad outcomes:

- *populate at build time* ⇒ a full 220 MB Happy rebuild + republish for **every** ev-copilot publish;
- *rewrite `manifest.json` in place at publish time* ⇒ the artifactId no longer identifies its
  content, and `Install-EvCopilotVersion`'s "destination already exists ⇒ trust the local receipt"
  short-circuit (`published :871-872`) would **never re-fetch the corrected manifest** — silent staleness;
- *republish under a new artifactId per pairing* ⇒ 220 MB duplicated per ev-copilot version.

The release-set record already carries `evCopilot.{artifactId, manifestSha256, copilotPackageVersion}`
and `happy.{artifactId, manifestSha256}` and is already compared against the launch context
field-by-field. It is the correct — and existing — joint pinning layer. `compatibility.evCopilot`
is strictly redundant with it and strictly more expensive.

**Also required (producer side):**
1. `Publish-EvCopilot.ps1` must emit ev-copilot `manifest.schemaVersion: 2` plus
   `copilot: { packageVersion: "1.0.71-3", nodeVersion, executable: "payload/node.exe",
   fixedArguments: ["payload/dist-cli/index.js"] }` (D3). Additive; safe for the deployed launcher.
   `packageVersion` must be the SDK package version the fork actually reports on `connect`, i.e.
   the value that must equal `COPILOT_NATIVE_VERSION` (`launchContext.ts:401-404`) — **not** the
   edition version `1.0.76-ev.12`.
2. `portable-artifact.cjs` should emit `compatibility.evCopilot: []` deliberately (a documented
   "unbound" marker) once the consumer accepts it, and keep hard-coding
   `copilotPackageVersions: ['1.0.71-3']` from `COPILOT_NATIVE_VERSION` — ideally by importing the
   constant rather than duplicating the literal at `:1639`.

**On the runtime handshake: it is not sufficient (D4), and it should not be strengthened by gating
on `registry.copilotVersion`.** That field is `"0.0.1"` on real T6 entries. The launcher — which has
verified hashes for both artifacts — is the version authority; the mirror should trust the
launch-context/release-set it was handed. As a *future* belt (fork-side, additive, and compatible
with the current parser since `parseUiServerRegistryFile` does not reject unknown keys): have the
fork write the real edition version and the ev artifactId into the registry entry, then let a later
Happy release cross-check them against the launch context.

**Rejected alternatives.**
- *`requiredHappyReleaseSet` in the ev-copilot channel pointer.* Rejected: inverts ownership — an
  ev-copilot publish would then be blocked on a Happy publish, and the ev-copilot channel pointer is
  consumed by the deployed schema-1 launcher which must keep working untouched.
- *A third joint `releaseSet.json` "pinning both" as a new invention.* Rejected only as *new* —
  it is exactly the right idea and it **already exists** as `cachedReleaseSetSchema`. Reuse it.
- *Runtime handshake only.* Rejected per D4.

**Risks.** Relaxing a fail-closed check is the one place this proposal weakens a security posture.
Mitigation: the relaxation removes a *redundant* predicate, not a unique one — `:492-499` still
requires an exact hash match on both artifacts, and `:500-519` still requires the receipt's
`channelPointerSha256` to equal the release-set's. Land it with a test that proves a mismatched
`evCopilot.manifestSha256` in the release-set still throws `cached-release-set-mismatch`.

---

## Q4 — Launcher orchestration (where the auto-attach mirror lives)

**Recommendation: (a′) — the launcher spawns the mirror, but discovers the PID via a pre-armed
`Win32_Process` parent-PID waiter, because `& $node` is a blocking foreground call (D5).**

Sketch, inserted in `Invoke-EvCopilot` immediately after `Ensure-EvCopilotProxy $Arguments`
(published `:1097`) and before the env setup at `:1099`:

```powershell
$happy = Ensure-EvCopilotHappyRoute $active          # resolve+verify release set; returns $null if not routing
if ($happy) {
    # Arm BEFORE the blocking child starts. The launcher shell has exactly one
    # node.exe child, so ParentProcessId is an unambiguous correlator even with
    # many concurrent terminals. Same CIM technique as Find-EvCopilotManagedProxyProcess.
    $waiter = Start-Job -ScriptBlock {
        param($launcherPid, $happyNode, $happyEntry, $timeoutSec)
        $deadline = (Get-Date).AddSeconds($timeoutSec)
        while ((Get-Date) -lt $deadline) {
            $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$launcherPid" -EA SilentlyContinue |
                     Where-Object { $_.Name -eq 'node.exe' } | Select-Object -First 1
            if ($child) {
                & $happyNode $happyEntry copilot --started-by terminal --attach-ui-server $child.ProcessId
                return
            }
            Start-Sleep -Milliseconds 250
        }
    } -ArgumentList $PID, $happy.Node, $happy.Entry, 30
    $env:COPILOT_HAPPY_EMBED = '1'                    # fork seam gate
    $env:HAPPY_ENABLE_COPILOT_NATIVE = '1'            # copilotCommand.ts:33
}
```

**Why this and not the alternatives.**

- **(b) daemon watches the registry dir and auto-attaches.** Rejected. It makes the daemon
  aggressive toward processes it did not launch, including plain `copilot` runs the operator did
  not want mirrored; it has no way to know the verified release set for a given terminal; and it
  would mirror the six stale/foreign entries already on disk (D9). It also breaks the explicit
  opt-in posture (`HAPPY_ENABLE_COPILOT_NATIVE`, `COPILOT_HAPPY_EMBED`) that both codebases were
  built around.
- **(c) ev-copilot spawns the mirror itself when `COPILOT_HAPPY_EMBED=1`.** Rejected for Phase 1.
  It puts release-set resolution, hash verification, and cache management inside the fork — the
  exact responsibilities the launcher exists to own — and every change would need a fork rebuild +
  republish. Worth reconsidering only if the launcher-side waiter proves unreliable.
- **`Start-Process -PassThru -NoNewWindow` to get the PID directly.** Rejected. It changes console
  ownership, `Ctrl+C` / console-control-event delivery, and stdin handedness for an interactive TUI
  — the highest-risk possible change to the thing the operator uses all day, in exchange for
  avoiding a 250 ms poll loop.
- **Spawn the mirror first with bare `--attach-ui-server` (auto-discovery).** Rejected. Auto-discovery
  throws immediately on zero entries (`uiServerRegistry.ts:220-222`) and on >1 entry
  (`:223-229`) — it races the not-yet-written entry and breaks outright with two terminals open.
  Note the launcher may also pass the PID via `HAPPY_COPILOT_ATTACH_UI_SERVER`
  (`copilotCommand.ts:26-30`, `:70`) instead of argv; argv is preferable because it is visible in
  `Get-CimInstance` output for debugging.

**Multiple concurrent terminals:** solved structurally. Each launcher shell has its own `$PID` and
exactly one node.exe child; correlation never consults the shared registry directory for selection.

**Mirror lifecycle when the terminal exits:** already self-managing — do **not** add launcher-side
teardown. `attachUiServerTarget` (`uiServerRegistry.ts:298-334`) polls every 5 s and resolves
`waitForUnavailable` when the PID dies or the entry goes stale, and `runCopilotMirror` shuts down on
that signal. The `Start-Job` waiter should therefore *not* be `Wait-Job`'d or killed in the `finally`
at `published :1123-1133`; let it run to completion. Do reap completed jobs opportunistically on the
next launch to avoid job-table accumulation in long-lived shells.

**Crash/restart:** if the mirror dies, the terminal is unaffected (read-only mirror). Do **not**
add a restart loop in Phase 1 — a crash-looping mirror against a bad release set would spam the
console during interactive work. Phase 3 can add at most one bounded retry.

**Should the mirror outlive the launcher shell?** No. It should outlive the *waiter job* but die
with the terminal it mirrors. That is what the registry-liveness monitor already gives.

**Logging.** The mirror writes to `~/.happy/logs/`. Add exactly one launcher-side line on the
routing decision (`ev-copilot: happy route <releaseSetId> (attaching)` / `… not routing: <reason>`),
matching the terseness of `Ensure-EvCopilotProxy`. Persist a `happy\process.json` state file
mirroring `Write-EvCopilotProxyProcessState` (`published :543-558`) so `ev-copilot doctor` can report it.

**Risks.** `Get-CimInstance Win32_Process` filtered by `ParentProcessId` is a few-ms WMI query but
runs in a `Start-Job` runspace, which costs ~200-400 ms to spin up on Windows PowerShell 5.1 — it
must be started *before* the blocking call so that cost overlaps with copilot's own startup, which
the sketch does. If WMI is unavailable/blocked by policy the waiter times out silently after 30 s
and the terminal is unaffected (fail-open).

---

## Q5 — Daemon lifecycle and `HAPPY_HOME_DIR`

**Recommendation A: the launcher must NOT run `happy daemon start`.** `copilotCommand.ts:85`
already calls `ensureDaemonRunning(...)` on the mirror's own startup path, before
`runCopilotMirror`. Duplicating it in PowerShell adds a second racing writer to
`daemon.state.json.lock` for zero benefit.

**Recommendation B: keep `HAPPY_HOME_DIR` at the default `~/.happy`, and retire the global npm
`happy` install on machines where routing is enabled.**

This is the consequential call, and there is a real collision to avoid:

- `configuration.ts:114-115` reads `currentCliVersion` from the bundled `package.json` and
  `currentPayloadIdentity` from `HAPPY_PAYLOAD_ARTIFACT_ID` / `HAPPY_PAYLOAD_MANIFEST_SHA256`
  (`envNames.ts:5-6`).
- `isDaemonStateCompatible` (`controlClient.ts:186-193`) returns false whenever a payload-bound
  invocation meets a daemon whose state lacks matching payload fields.
- The live `~/.happy/daemon.state.json` has **no** payload fields (D7).

So a payload-bound Happy launched from the OneDrive cache would find the operator's global-npm
daemon incompatible. In *attach* mode `requireIdleForReplacement` is `false`
(`copilotCommand.ts:85`, since `launchContext` is undefined), so `ensureDaemonRunning` skips the
graceful drain reservation at `ensureDaemonRunning.ts:22-53` and goes straight to
`spawnHappyCLI(['daemon','start-sync'])` at `:60`; the new daemon then stops the old one on version
mismatch. The next plain `happy` invocation reverses it. **That is a daemon flap-war**, and it
would surface to the operator as sessions disappearing from the phone.

Three ways out:

| option | effect | verdict |
|---|---|---|
| EvCopilot-scoped `HAPPY_HOME_DIR` (e.g. `%LOCALAPPDATA%\EvCopilot\happy-home`) | separate keys, separate daemon, no flap | **rejected** — see below |
| retire/repoint the global npm `happy`; OneDrive payload is the only Happy | one home, one daemon, one machine identity | **recommended** |
| make payload-bound Happy tolerate absent-payload daemons | undoes a deliberately built guarantee | rejected |

**Pairing does not survive a home-dir move — confirmed.** `configuration.ts:82-109` derives
`access.key`, `ecdh-key.priv`, `machine.json`, `local-paired-devices.json`,
`public-paired-devices.json`, and `server-storage.key` from `happyHomeDir`. A new home means a new
machine identity and a full re-pair of the phone/web clients, plus a permanent duplicate machine in
the Happy app and split session history. For a seamless-UX goal, that is a worse outcome than
uninstalling one npm package.

`happy-dev` (`~/.happy-dev`) is untouched by this and remains the correct inner-loop escape hatch
(per `.agents/skills/happy-cli-iterate-no-release`).

**Recommendation C: attach mode is correct to skip the routed-replacement drain.** Do not "improve"
`copilotCommand.ts:85` to pass `requireIdleForReplacement: true` for attach mode. That path is
designed for a *launch-context-owning* replacement and refuses while any children exist
(`docs/copilot-cli-integration.md:1137-1140`) — using it for attach would make opening a second
terminal fail hard. Once (B) is adopted there is only one Happy identity and the question is moot.

**Risks.** Retiring the global install means a broken OneDrive payload leaves the operator with no
`happy` at all. Mitigate: keep `happy-dev` installed globally, and keep the previous Happy artifact
cached (Q6) so `previousReleaseSetId` rollback is always local.

---

## Q6 — Update / rollback UX

**Recommendation: mirror the runtime's pin/current/previous exactly, and make the switch take
effect on the *next* launch rather than mid-session.**

- **Trigger:** on every launch, inside `Ensure-EvCopilotHappyRoute`, read
  `happy\channels\local-preview.json` and compare `releaseSetId` to `config.happy.currentReleaseSetId`
  — a single small JSON read, exactly like `Get-EvCopilotActiveVersion:940-950`. Also honour an
  explicit `ev-copilot happy update`.
- **`pinnedReleaseSetId` short-circuits the channel read entirely**, mirroring `published :937`.
- **Rollback:** `ev-copilot happy rollback` swaps current↔previous and sets the pin, mirroring
  `published :1077-1089`. Never lowers `highestSeenSequence` (Q1).
- **Running daemon + mirrors when a new release set installs: leave them alone.** Install the new
  artifact into the cache, set `pendingReleaseSetId`, print one line, and let the next launch
  promote it. This is precisely why `pendingReleaseSetId` exists in the reserved schema
  (repo `:415`) and it is the only safe answer — a mid-session daemon swap would sever every live
  mirror and, under `requireIdleForReplacement`, would be refused anyway while children exist.
- **Retention:** keep `current`, `previous`, and any `pinned` release set's artifacts; garbage-collect
  the rest on a successful launch, oldest first. At ~220 MB per Happy artifact this cannot be
    deferred the way the 36 accumulated ev-copilot versions were. Publish-side retention is a
  separate, and now overdue, chore.

**Rejected alternatives.**
- *Update only on explicit `ev-copilot update`.* Rejected: the whole point is zero ritual, and the
  proxy precedent already auto-syncs on every launch (`Ensure-EvCopilotProxy:668-700`).
- *Hot-restart the daemon on new release set.* Rejected per above.
- *Restart live mirrors to match a new artifact.* Rejected: mirrors are read-only observers; a
  version-skewed mirror is strictly better than a severed session.

**Risks.** A first-time hydration of a 220 MB zip on a cold machine will visibly delay the *first*
routed launch. Mitigate by doing the fetch/verify/extract in a background job and simply not routing
that launch (fail-open) — route from the next one.

---

## Q7 — Failure modes

Invariant for every row: **the terminal launches**. `Ensure-EvCopilotHappyRoute` returns `$null`
and `Invoke-EvCopilot` proceeds to `:1121` unchanged.

| # | failure | detection | operator-visible message | degraded behaviour |
|---|---|---|---|---|
| 1 | OneDrive offline / unsynced | channel pointer read throws | `happy route: channel unavailable; using cached release set <id>` | route from cache if verified, else no route |
| 2 | Placeholder/dehydrated file (0-byte OneDrive stub) | `COMPLETE.json` missing, or `archive.length` mismatch | `happy route: payload not hydrated yet; skipping` | no route; background hydrate for next launch |
| 3 | Partial payload | `archive.sha256` mismatch, or expanded `files[]` inventory mismatch | `happy route: payload verification failed (<artifactId>); skipping` | no route; do **not** delete the source, do delete the local staging dir |
| 4 | Manifest hash mismatch vs pointer/COMPLETE | `Test-*Package`-equivalent throw | `happy route: manifest binding mismatch; refusing` | fail-closed on routing only |
| 5 | Release-set sequence regression | `sequence < highestSeenSequence` | `happy route: rejected release set <id> (sequence <n> < <m>)` | keep current; warn once per pointer id |
| 6 | ev-copilot pin has no matching release set | candidate set empty (Q1) | `happy route: no release set pairs with pinned runtime <artifactId>` | no route |
| 7 | Daemon port conflict / won't become ready | `ensureDaemonRunning` throws after 60 s (`ensureDaemonRunning.ts:71-90`) | mirror's own error text + `happy doctor` hint | mirror exits; terminal unaffected |
| 8 | Stale registry entries (**live today**, D9) | `uiServerRegistry.ts:152-158` (5-min mtime + PID liveness) | none (silently skipped, `:289-291`) | correct as-is; add a `doctor` line that *counts* stale entries |
| 9 | Registry entry never appears (fork seam off / older ev-copilot) | waiter times out at 30 s | `happy route: terminal did not publish a ui-server entry` (write to the happy log, not the console — the TUI owns the console by then) | no mirror |
| 10 | Mirror crash-loop | job exits non-zero repeatedly | `ev-copilot doctor` reports last exit + log path | **no auto-restart in Phase 1** |
| 11 | Version-mismatch refusal (`LaunchContextError`) | thrown by `readEvCopilotLaunchContext` | code-only message (e.g. `release-set-incompatible`) in the happy log | no mirror; terminal unaffected |
| 12 | Daemon identity flap (Q5) | `startedWithPayloadArtifactId` absent/mismatched | `ev-copilot doctor`: `happy: conflicting global install detected` | **prevent** by retiring the global install |
| 13 | Two launchers racing the same install | `Move-Item` onto an existing dir | already handled: `published :893-895` throws `…appeared concurrently` | one wins; loser re-validates the cache and proceeds |
| 14 | WMI/CIM unavailable | waiter finds nothing | log-only | no mirror |
| 15 | Disk full mid-extract | extract throws | `happy route: install failed (<reason>)` | staging dir removed in `finally`, mirroring `published :897-899` |

**Escape hatch — recommendation: env var + config, not an argv flag.**
`EV_COPILOT_HAPPY_ROUTE = off | auto | always` (default `auto`), read exactly like
`Get-EvCopilotProxyAutostartMode` (`published :586-594`), plus persistent `config.happy.mode`
(`off`/`route`, already defined at repo `:411`, `:426-432`) and an `ev-copilot happy off` verb.

**Do not add a `-NoHappy` flag.** `Invoke-EvCopilot` matches `$Arguments[0]` against its subcommand
table (`published :1044-1090`) and splats everything else to copilot (`:1121`). A flag anywhere
other than position 0 is ambiguous with copilot's own grammar, and consuming position 0 would
shadow a real copilot argument. The proxy — the direct precedent — is env-only for exactly this reason.

---

## Q8 — Phasing and repo boundaries

### Phase 0 — reconcile the module lineage *(blocking; `copilot-runtime-workspace`)*

Nothing else may ship until this is done (D1).
1. Treat the **published** 1146-line module as the source of truth for the 17 production-only functions.
2. Port `New-EvCopilotConfig` / `Initialize-EvCopilotConfigV2` (repo `:353-447`) onto it, keeping
   `Save-EvCopilotConfig`'s schema stamp consistent (choose 2, and confirm the published
   `Get-EvCopilotConfig` path accepts it — it does not validate `schemaVersion` at all, `:736-756`).
3. Commit the reconciled module to `copilot-runtime-workspace` and push, so the two machines'
   clones converge and `Publish-EvCopilot.ps1:386` becomes safe again.
4. Add a publish-time guard: refuse to publish a module that is missing any function present in the
   currently published one. This class of regression must not be able to recur.

**Repo-boundary risk:** the publish script bundles a module publish into every *version* publish.
Until Phase 0 lands, **any** `Publish-EvCopilot.ps1` run from this machine ships the regression.

### Phase 1 — smallest slice that gets seamless steering on 2+ machines

**codexu (small, surgical):**
- Relax `compatibility.evCopilot` to allow empty and drop the `compatibleRuntime` predicate
  (`launchContext.ts:150-154`, `:461-471`); keep every other check. Add a regression test proving
  release-set mismatch still throws.
- Import `COPILOT_NATIVE_VERSION` in `portable-artifact.cjs` instead of the literal at `:1639`.
- Update `docs/copilot-cli-integration.md:1211-1218` (stale, D6).

**copilot-runtime-workspace (the bulk):**
- `Publish-EvCopilot.ps1`: emit ev-copilot `manifest.schemaVersion: 2` + `copilot { … }` (D3).
- New `Publish-EvCopilotHappy.ps1`: takes a built Happy artifact dir + a target ev-copilot
  artifactId → writes `happy\versions\<id>\`, mints the release-set record with
  `sequence = max+1`, writes `happy\channels\local-preview.json`. Must run the
  `Assert-EvCopilotProvidersJson`-equivalent secrets check: **assert the payload contains no
  `access.key`, `ecdh-key.priv`, `public-tunnel.json`, `machine.json`, `settings.json`, or
  `*paired-devices.json`.** (`portable-artifact.cjs`'s `scanForbidden`/`scanMachineMetadata` at
  `:616-687` already does much of this — call it, don't reimplement.)
- Module: `Sync-EvCopilotHappyFromOneDrive` (mirrors `Sync-EvCopilotProxyFromOneDrive:399-431`),
  `Install-EvCopilotHappyReleaseSet` (mirrors `Install-EvCopilotVersion:846-911` staging pattern),
  `Ensure-EvCopilotHappyRoute` (mirrors `Ensure-EvCopilotProxy:657-713`), the Q4 waiter, and
  `ev-copilot happy {status|update|pin|rollback|off}` verbs.
- `Write-EvCopilotProxyPrereqs`-style `happy` section in `doctor`.

**Explicitly out of Phase 1:** `--launch-context` mode. Attach mode needs no `run\<invocationId>\`
directory, no status-file state machine, no ownership protocol, and no routed daemon replacement —
`copilotCommand.ts:71-73` makes the two modes mutually exclusive anyway. Phase 1 = attach only.

**Acceptance:** on machine A and machine B, opening `ev-copilot` produces a Happy session visible on
the phone with `/happy grant` working, with no env vars typed and no `happy` command run by hand;
and `EV_COPILOT_HAPPY_ROUTE=off ev-copilot` behaves exactly as today.

### Phase 2 — hardening
Retention/GC for both artifact trees; background pre-hydration of a pending release set; one
bounded mirror retry; fork-side: write the real edition version + ev artifactId into the ui-server
registry entry; `doctor` reports stale-entry counts.

### Phase 3 — launch-context (owned) mode
Only if headless/daemon-launched Copilot is actually wanted. This is where `run\<invocationId>\`,
the `initializing → owned → completed` status machine, and the routed daemon drain reservation
become necessary. It is a substantially larger protocol surface and is not needed for the stated goal.

**Repo-boundary risks.**
- The compatibility relaxation is the only cross-repo coupling: the launcher cannot publish a usable
  Happy artifact until it lands in codexu **and** a new artifact is built from that commit
  (`portable-artifact.cjs` builds from an immutable clean-tree snapshot, `:1398`, `:1421`).
  Sequence it first.
- **`portable-artifact.cjs` refuses to build under OneDrive** (`isUnderOneDrive`, `:229-236`) and
  confines all output under the repo root (`assertSafeOwnedPath`). The build must therefore happen
  in the repo and be *copied* to OneDrive by the publish script — the builder will not write there.
- `COPILOT_NATIVE_VERSION` / `COPILOT_PROTOCOL_VERSION` / `COPILOT_REGISTRY_SCHEMA_VERSION`
  (`types.ts:7-9`) are duplicated as literals in `portable-artifact.cjs:1637-1639`. Any fork SDK
  bump requires a coordinated edit in **three** places (fork, `types.ts`, builder) — this is the
  drift vector that already caused three interop bugs. De-duplicate in Phase 1.
- `copilot-runtime-workspace` has an unrelated dirty worktree (`.tasks-board/worktrees/`) and is
  `ahead 3` of origin. Push before publishing anything.

---

## Open decisions only the operator can make

1. **Which `EvCopilot.psm1` lineage is authoritative,** and where does the machine that produced the
   published 1146-line module live? Phase 0 cannot be executed correctly without this. (If that
   machine has further unpublished work, reconciliation must happen there, not here.)
2. **Retire the global npm `happy` install?** (Q5.) The alternative — a separate `HAPPY_HOME_DIR` —
   costs a full phone re-pair and a permanent duplicate machine in the Happy app. Recommend yes;
   this is a preference call about the operator's existing workflow.
3. **Accept relaxing `compatibility.evCopilot`?** (Q3.) It removes a redundant fail-closed predicate
   in exchange for not rebuilding 220 MB per ev-copilot publish. If the answer is no, the fallback
   is publish-time manifest rewriting under a *new* artifactId, at ~220 MB per pairing.
4. **Default routing mode:** `auto` (route when a valid release set pairs with the active runtime)
   vs `off` until explicitly enabled per machine. Recommend `auto`, given `config.happy.mode`
   defaults to `"off"` today (repo `:362`, `:411`) — that default must be flipped or the reserved
   scaffolding will keep everything dark.
5. **OneDrive budget / retention.** 36 ev-copilot versions ≈ 11 GB already; Happy adds ~220 MB per
   artifact. How many of each to keep on OneDrive, and may the publisher delete old ones?
6. **Is `--launch-context` (owned) mode wanted at all,** or is attach-only sufficient forever? This
   determines whether Phase 3 exists and whether the `run\<invocationId>\` protocol needs a producer.
7. **Fork-side registry enrichment** (real `copilotVersion` instead of `"0.0.1"`, plus the ev
   artifactId): worth a fork change now, or defer to Phase 2?

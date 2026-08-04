
# Happy CLI over OneDrive — EvCopilot launcher integration (Sol lens)

**Lens:** GPT-5.6 Sol (independent; sibling lens = Claude Opus 5)
**Date:** 2026-08-04 · **Scope:** design recommendation only; read-only investigation, no code written.

## Executive summary

- Treat a **release set as one immutable, live-validated pair of exact EvCopilot and Happy artifacts**, not as Happy plus a semantic-version range.
- Fail closed for Happy routing, but always fail open to a normal route-less EvCopilot terminal.
- Publish Happy as a hermetic ZIP containing pinned `node.exe` plus the complete production deployment closure.
- `Invoke-EvCopilot` should supervise the terminal and spawn one exact-PID Happy mirror; neither the daemon nor EvCopilot should discover/spawn mirrors globally.
- Keep the normal `~/.happy` home so existing keys, pairing, and tunnel configuration survive.
- Stage updates as `pending`; never replace a busy daemon or mutate running mirrors.
- Use a joint, monotonically sequenced release-set channel pointer plus an attach-specific runtime contract handshake.
- Phase 1 requires changes in `codexu` and `copilot-runtime-workspace`, but no new EvCopilot product change beyond its already-shipped T6 embed seam.

---

## 1. Release-set semantics

### Recommendation

A release set should be an immutable record of an **exact tested composition**:

```json
{
  "schemaVersion": 1,
  "releaseSetId": "20260804T...-...",
  "sequence": 17,
  "channel": "local-preview",
  "evCopilot": {
    "artifactId": "...",
    "manifestSha256": "...",
    "editionVersion": "1.0.76-ev.12",
    "sourceCommit": "..."
  },
  "happy": {
    "artifactId": "...",
    "manifestSha256": "...",
    "archiveSha256": "...",
    "cliVersion": "1.1.8-evy.11"
  },
  "controller": {
    "attachRegistrySchema": 1,
    "connectProtocolVersion": 3,
    "actorContract": "happy-steering-v1"
  },
  "validation": {
    "liveE2ePassed": true,
    "validatedAtUtc": "..."
  }
}
```

Store it under:

```text
happy/release-sets/<releaseSetId>.json
happy/channels/local-preview.json
```

The channel pointer should contain only:

```json
{
  "sequence": 17,
  "releaseSetId": "...",
  "releaseSetSha256": "..."
}
```

Each set names one exact EvCopilot artifact and one exact Happy artifact. If one Happy build works with three EvCopilot builds, publish three release-set descriptors referencing the same Happy artifact.

### Selection and pin precedence

1. `-NoHappy` or `happy.mode=off`: use the normal EvCopilot selector and do no Happy work.
2. If `pinnedVersion` is set, it remains authoritative for EvCopilot.
3. A `pinnedReleaseSetId` is eligible only if it names that exact pinned EvCopilot artifact.
4. Without an EvCopilot pin, `happy.mode=route` lets the joint release-set channel select both artifacts.
5. An incompatible or unavailable Happy set causes a **route-less terminal launch**, never an EvCopilot launch failure.
6. Never silently upgrade or downgrade an explicit EvCopilot pin to satisfy Happy.

Thus the answer to “fail closed or fail open?” is **both at different boundaries**: refuse incompatible routing, but always launch the terminal.

### `highestSeenSequence`

- `sequence < highestSeenSequence`: reject as stale and continue with the cached current set.
- Same sequence and same pointer hash: idempotent retry, including retrying `pendingReleaseSetId`.
- Same sequence with different content/hash: treat as channel equivocation or OneDrive conflict; warn and ignore.
- Higher sequence: after validating the pointer and release-set descriptor binding, record the new highest sequence and set `pendingReleaseSetId`.
- Promote `pending` to `current` only after both artifacts are completely installed and a safe daemon handoff is possible.
- A deliberate rollback is published as a **new higher sequence** pointing to old artifact hashes.

This protects against OneDrive synchronization reordering, not a malicious OneDrive writer. The existing distribution explicitly accepts an unsigned owner-only threat model with no malicious-writer protection (`Publish-EvCopilot.ps1:326-355`; current OneDrive manifest `manifest.json:7-15`).

### Rationale

The current Happy launch-context implementation already validates exact artifact IDs and manifest hashes, not edition ranges (`packages/happy-cli/src/agent/copilot/launchContext.ts:394-415,461-470,492-518`). That is the correct posture for a private contract that has already drifted in non-SemVer ways.

The launcher config already has the right transactional fields—current, previous, pinned, pending, and highest sequence—and defaults routing off (`scripts/EvCopilot.psm1:353-368,403-435`). Config writes are atomic (`scripts/EvCopilot.psm1:464-477`).

### Rejected alternatives

- **Happy artifact plus compatible edition range:** rejected. `1.0.76-ev.N` does not encode private actor-contract compatibility, and source-composition changes can break interop without changing upstream SemVer.
- **Happy release-set pin overriding the EvCopilot pin:** rejected as surprising and unsafe.
- **Failing the entire terminal launch:** rejected. Happy is an enhancement.
- **Automatically falling back to an arbitrary “nearby” Happy version:** rejected because it recreates the drift problem.
- **Sequence without descriptor hash binding:** rejected; OneDrive could expose a pointer and descriptor from different synchronization moments.

### Risks

- Dual pins can confuse users. `doctor` must print the selected EvCopilot artifact, requested Happy set, incompatibility reason, and actual degraded behavior.
- Unsigned sequence counters are not cryptographic anti-rollback.
- A mistakenly published high sequence requires a corrective publication at a still-higher sequence.

---

## 2. Payload shape

### Recommendation

Use **option (a): pinned portable `node.exe` plus the complete production Happy deployment closure**.

Extracted payload:

```text
payload/
  node.exe
  NODE-LICENSE.txt
  happy/
    package.json
    dist/
    node_modules/
    ...required generated Prisma/server assets...
manifest.json
COMPLETE.json
sbom.spdx.json
licenses.json
happy-win32-x64.zip
```

Invoke it directly:

```text
payload\node.exe payload\happy\dist\index.mjs ...
```

Do not depend on npm-generated `happy.ps1`, global Node, npm, pnpm, or a target-machine install step.

### Rationale

The existing builder already implements most of this design:

- Builds Happy Wire, Happy Server, and Happy CLI before deployment (`portable-artifact.cjs:1450-1453`).
- Uses `pnpm deploy --prod --legacy` to materialize the workspace dependency closure (`portable-artifact.cjs:1454-1473`).
- Adds a pinned Node distribution and its license (`portable-artifact.cjs:1486-1499`).
- Emits a complete inventory, ZIP, SBOM, licenses, manifest, and COMPLETE binding (`portable-artifact.cjs:1502-1539,1604-1673`).
- Runs the extracted artifact outside the repository with an empty `PATH` and no global Node search paths (`portable-artifact.cjs:1264-1332,1353-1363`).

The package is not safely “dist-only”: `happy-cli` depends directly on workspace `@slopus/happy-wire` and `happy-server`, plus many runtime npm packages (`packages/happy-cli/package.json:68-104`).

One remaining hermeticity defect must be fixed: internal Happy child launches currently resolve literal `node` from `PATH`, rather than using the portable process’s `process.execPath` (`packages/happy-cli/src/utils/spawnHappyCLI.ts:89-112`). The current portable smoke runs only `happy copilot --help`, which returns before daemon startup (`packages/happy-cli/src/commands/copilotCommand.ts:64-66,83-85`), so it does not expose this defect.

### Rejected alternatives

- **Dist-only:** rejected because it silently depends on external modules, generated server assets, and target-machine Node behavior.
- **npm tarball plus install:** rejected because it introduces mutable global state, npm/pnpm availability, network/cache behavior, Windows shim generation, and slow non-atomic cold starts.
- **Executing from OneDrive:** rejected. The existing launcher correctly copies and verifies into local cache first (`scripts/EvCopilot.psm1:547-600`), and the proxy follows the same execute-local rule (`scripts/EvCopilot.psm1:197-228`).
- **Including `~/.happy`:** categorically rejected.

### Risks

- The portable artifact is materially larger than a bundle-only output.
- A production daemon smoke must be added; the existing help smoke is insufficient.
- Native dependencies and generated Prisma assets require release-time Windows validation.

---

## 3. Compatibility contract

### Recommendation

Use three layers:

1. **Joint release set:** authoritative exact artifact pairing.
2. **Artifact-level controller contract:** each Happy artifact declares protocol/actor revisions it implements, but not an EvCopilot SemVer range.
3. **Runtime actor handshake:** verify the live actor before exposing steering.

Add a fork RPC such as:

```json
happy.getProtocolInfo -> {
  "actorContract": "happy-steering-v1",
  "connectProtocolVersion": 3,
  "methods": [
    "happy.attach",
    "happy.requestLease",
    "happy.heartbeat",
    "happy.releaseLease",
    "happy.answerPrompt",
    "happy.getControlState"
  ],
  "requiresActionId": true,
  "requiresLeaseId": true
}
```

The self-reported result must agree with the externally verified release-set context. It cannot replace artifact verification.

For phase 1, exact release-set identity plus the existing connect handshake is acceptable if the pair has passed a live E2E test. Add the explicit actor handshake in the next increment.

### Why the current `copilotVersion` gate is insufficient

The transport client sends protocol version `"3"` as a string, expects numeric `3` in the response, and compares the response package version against the version supplied from the registry (`nativeLocalRpcClient.ts:165-177`). That catches low-level transport mismatches.

However, the live T6 UI-server registry currently reports:

```text
C:\Users\evmitran\.copilot\servers\22508.json:2  schemaVersion: 1
C:\Users\evmitran\.copilot\servers\22508.json:8  copilotVersion: "0.0.1"
```

Therefore, UI attach currently checks that the actor returns the same placeholder carried in its registry. It does not establish compatibility with edition `1.0.76-ev.12`, an artifact hash, or the required steering request fields.

The hard-coded Happy constant `1.0.71-3` applies to the managed-server path (`packages/happy-cli/src/agent/copilot/types.ts:7-9`), not the live schema-1 terminal UI server.

### Authority placement

- **Joint `releaseSet.json`: yes.** This is the compatibility authority.
- **`compatibleEditions` range in Happy manifest: no.**
- **`requiredHappyReleaseSet` in the ordinary EvCopilot channel pointer: no.** EvCopilot remains independently usable, and that would couple route-less publication to Happy.
- An advisory release-set ID in diagnostics is harmless, but selection must use the separate joint pointer.
- **Runtime handshake only: no.** It cannot prove which bytes were launched and detects drift too late.

### Rejected alternatives

- SemVer range enforcement.
- Capability-string-only enforcement.
- Trusting `copilotVersion: "0.0.1"`.
- Inferring compatibility from the presence of the T6 capability label.
- Treating a successful socket connection as proof that all lease/prompt fields match.

### Risks

- The actor handshake requires a small EvCopilot fork change.
- Schema ownership crosses repositories; golden cross-repo fixtures and explicit schema versions are required.
- Compatibility metadata must never include registry tokens or filesystem paths.

---

## 4. Launcher orchestration

### Recommendation

Choose **option (a): `Invoke-EvCopilot` supervises one exact terminal PID and one exact-PID Happy mirror**.

Proposed flow:

1. Resolve and verify the selected release set.
2. Set `COPILOT_HAPPY_EMBED=1` only in the EvCopilot child environment.
3. Start EvCopilot with an API that returns its real process object/PID while preserving the current console.
4. Wait boundedly for `~/.copilot/servers/<pid>.json` to become fresh and valid.
5. Create a non-secret attach launch context containing the release-set identity and exact target PID.
6. Start the cached Happy payload with:
   - `HAPPY_ENABLE_COPILOT_NATIVE=1`
   - `HAPPY_PAYLOAD_ARTIFACT_ID`
   - `HAPPY_PAYLOAD_MANIFEST_SHA256`
   - `happy copilot --started-by terminal --attach-ui-server <pid> --launch-context <path>`
7. Wait briefly for Happy to record `owned`; otherwise warn and continue route-less.
8. Wait for the terminal to exit, preserve its exit code, and clean invocation files when safe.

The mirror should be independent enough to survive an unexpected wrapper-shell exit, but it must remain target-owned: once the terminal PID dies or its registry heartbeat goes stale, the mirror exits.

The existing attach monitor already checks registry freshness and process liveness (`uiServerRegistry.ts:298-333`), and the mirror treats target unavailability as termination (`runCopilotMirror.ts:486-503`).

### Important required adjustment

The current Happy CLI explicitly forbids combining attach mode with a launch context (`commands/copilotCommand.ts:71-72`; `runCopilotMirror.ts:198-204`). That must be changed to support an **attach-specific context** whose ownership is the external target PID rather than a Happy-spawned managed server.

The current context path instead causes Happy to spawn a new managed-server process (`runCopilotMirror.ts:337-355`), which is not the operator’s terminal.

### Windows process model

The module currently invokes Node synchronously with `& $node $entry`, which preserves terminal behavior but exposes no child PID (`scripts/EvCopilot.psm1:774-805`). Replace this with a carefully tested `Start-Process -NoNewWindow -PassThru` or equivalent `.NET Process` supervisor, then call `WaitForExit()` on the direct process—not `Start-Process -Wait` over an uncontrolled process tree.

If supervised launch fails, fall back to the existing direct invocation route-less.

### Rejected alternatives

- **Daemon registry watcher:** rejected. It would attach aggressively to terminals it does not own, creates ambiguity with multiple terminals, and turns a machine daemon into a global policy engine.
- **EvCopilot spawning Happy:** rejected. It couples the product fork to OneDrive layout, Happy cache policy, daemon lifecycle, state-home policy, and rollback semantics.
- **Auto-discovery without PID:** rejected because multiple concurrent terminals are normal.
- **Restart loops in the daemon:** rejected for phase 1; they hide incompatibility and can create duplicate mirrors.

### Risks

- Console control, Ctrl+C, raw input, and exit-code propagation must be live-tested under Windows Terminal.
- The registry can appear after the terminal UI is already active; startup needs a bounded readiness window.
- A hidden child’s stderr must be captured to a local invocation log.
- Never place registry tokens in launch context, status, arguments, or logs.

---

## 5. Daemon lifecycle and Happy home

### Recommendation

Yes, every routed invocation should ensure the daemon—but **`happy copilot` should remain the owner of that operation**. `Invoke-EvCopilot` should not run a separate `happy daemon start` command first.

The current `happy copilot` command already authenticates, ensures the daemon, and only then starts the mirror (`commands/copilotCommand.ts:83-92`). Its readiness path starts a detached daemon and waits for state, HTTP bind, and health response (`daemon/ensureDaemonRunning.ts:55-90`).

Use the default shared:

```text
HAPPY_HOME_DIR = ~/.happy
```

Do not create an EvCopilot-specific Happy home by default.

### Rationale

The default home contains:

- `access.key`
- daemon state and machine identity
- public tunnel configuration
- paired-device pins
- local pairing data and server storage keys

(`packages/happy-cli/src/configuration.ts:82-109`).

Changing the home would create a new cryptographic identity and force re-pairing. Sharing binaries is safe; sharing state is necessary for continuity.

The cache remains separate under `%LOCALAPPDATA%\EvCopilot\happy`, while keys and pairing remain under `~/.happy`.

The daemon now distinguishes equal package versions built from different immutable artifacts by recording artifact ID and manifest hash (`daemon/controlClient.ts:343-368`; `daemon/run.ts:812-824`). That directly addresses the unchanged `1.1.8-evy.11` package-version problem.

### Busy-daemon behavior

If a different Happy payload owns a busy daemon:

- Do not kill it.
- Do not replace it.
- Do not run the new mirror against an unverified daemon.
- Launch the EvCopilot terminal route-less and explain that the Happy update is pending.

The replacement coordinator already refuses handoff with active children or in-flight admissions (`daemon/replacementCoordinator.ts:52-63`; `daemon/ensureDaemonRunning.ts:22-52`).

### Rejected alternatives

- **EvCopilot-scoped home:** rejected due to lost pairing and duplicate machine identities.
- **Copying Happy secrets through OneDrive:** prohibited.
- **Unconditionally stopping the daemon:** rejected because it disrupts existing sessions.
- **Running multiple daemons against one home:** rejected because they share state, ports, keys, and machine registration.

### Risks

- Existing global Happy invocations and routed Happy share one daemon lifecycle.
- An older busy daemon may defer routing updates for a long period.
- Testing must confirm that routed mirror sessions are included in the daemon’s busy/admission accounting.

---

## 6. Update and rollback UX

### Recommendation

Mirror the existing EvCopilot model:

```text
currentReleaseSetId
previousReleaseSetId
pinnedReleaseSetId
pendingReleaseSetId
highestSeenSequence
```

#### Update checks

- Every normal launch performs a cheap joint-pointer check.
- If unchanged, use the cached current pair immediately.
- If newer, verify and install into immutable cache, then mark it pending.
- `ev-copilot update` forces retry, deep verification, and clear reporting.
- `-NoHappy` bypasses Happy pointer/cache work entirely.

The ordinary EvCopilot launcher already checks the OneDrive channel opportunistically on launch and falls back to its verified local cache when OneDrive is unavailable or incomplete (`scripts/EvCopilot.psm1:625-657`).

#### Promotion

Do not switch a running daemon or mirror in place.

- If no routed work is active, promote pending to current and perform the existing exact-identity daemon handoff.
- If work is active, continue starting routed terminals from the current release set.
- Keep the new set pending until an idle launch.
- An explicit route-less invocation may still use the latest standalone EvCopilot channel.

This keeps every routed invocation on an exact coherent pair.

#### Rollback

- `rollback` swaps current and previous and pins the selected release set.
- Roll back the pair, not Happy independently.
- Local rollback requires both cached artifacts to reverify.
- Channel-wide rollback is a new, higher sequence pointing to old artifact hashes.

#### Retention

Never prune:

- current
- previous
- pinned
- pending
- artifacts referenced by live launch-status records

Beyond those, retain at least the newest two complete release sets and prune only after process-liveness checks.

### Rejected alternatives

- Hot-restarting daemon and mirrors on pointer change.
- Updating Happy independently from the selected EvCopilot artifact.
- Reusing mutable extraction directories.
- Automatically deleting the only previous known-good set.
- Running full npm installation during launch.

### Risks

- Holding the old pair while busy delays new EvCopilot features.
- Choosing latest EvCopilot route-less while Happy is pending may surprise users; diagnostics must state this explicitly.
- Cache pruning needs process-reference awareness, not age alone.

---

## 7. Failure modes

| Failure | Detection | Operator-visible result | Degraded behavior |
|---|---|---|---|
| OneDrive absent/offline | Root/pointer read failure | One concise “using cached release set” message; verbose detail in logs | Use verified cached current pair; if none, launch route-less |
| Cloud-only/partially hydrated files | Read/copy timeout, missing COMPLETE | “Happy update incomplete; retained current set” | Current pair or route-less |
| Pointer visible before descriptor/payload | Missing descriptor, COMPLETE, archive, or manifest binding | Mark pending and identify missing component | Do not promote |
| Manifest/archive hash mismatch | SHA-256 verification | High-signal integrity warning with artifact ID, never token/path dumps | Quarantine staging; current pair or route-less |
| Same sequence, different pointer | Sequence/hash comparison | “Conflicting channel pointer ignored” | Keep current |
| Cached payload corruption | Receipt/inventory validation | Identify corrupt artifact and suggest `ev-copilot update`/doctor | Try exact verified previous pair; otherwise route-less |
| Happy payload contains state/secrets | Publish-time forbidden-content scan | Publication fails | Nothing distributed |
| Daemon port/bind/tunnel failure | Existing 60-second readiness and daemon log diagnostics (`ensureDaemonRunning.ts:67-90`) | Print daemon-log location and route failure | Terminal continues |
| Different Happy daemon busy | Exact payload identity plus replacement reservation | “Happy update pending; daemon is busy” | Use current pair or route-less |
| Stale registry entry | Exact PID, mtime, process-liveness validation (`uiServerRegistry.ts:125-157,265-295`) | “Terminal registry did not become attachable” | Terminal continues |
| Multiple terminals | Avoided by exact PID selection | No ambiguity prompt | One mirror per terminal |
| Mirror startup crash | Status remains initializing/failure | One warning plus invocation log path | Terminal continues |
| Mirror crashes after ownership | Child exit/status/log | Session marked unavailable; no automatic phase-1 loop | Terminal remains local |
| Runtime protocol mismatch | Connect/actor handshake | Expected/actual contract revision, no secret data | Mirror exits; terminal continues |
| Terminal exits | Target PID/registry monitor | Normally silent | Mirror archives and exits |
| Wrapper shell dies | Terminal PID monitor remains authoritative | Log on next doctor invocation | Mirror exits when target dies/stales |
| Atomic extraction interrupted | Unique staging directory lacks promoted receipt | Next launch cleans/retries | Current pair remains |
| Supervised TUI spawn fails | Process creation exception | “Happy routing disabled; falling back to direct launch” | Existing direct EvCopilot invocation |
| `-NoHappy` | Parsed before all Happy work | Optional terse confirmation | Normal EvCopilot only |

Publisher security should follow the existing providers precedent: reject inline credentials before OneDrive writes (`scripts/EvCopilot.psm1:47-62,96-109`). Happy publication should likewise reject `.happy`, private-key names, tunnel configuration, logs, tokens, and credential-shaped content. The existing builder already has forbidden-content scanning and external-machine metadata scanning (`portable-artifact.cjs:1472-1500`).

---

## 8. Phasing and repository ownership

### Phase 1: smallest safe two-machine slice

#### `codexu`

1. Make portable child execution genuinely hermetic by using `process.execPath` for Happy child/daemon launches.
2. Extend the launch-context contract for external UI-server attachment:
   - exact target PID
   - exact release-set/artifact identities
   - attach registry schema 1
   - monotonic `initializing → owned → completed` status
3. Permit `--attach-ui-server <pid>` with the new attach context.
4. Move exact pair authority into the joint release-set descriptor; keep the Happy artifact manifest focused on controller contracts.
5. Add a real extracted daemon + mirror smoke, not only `--help`.
6. Preserve shared `~/.happy` and exact payload identity checks.

The existing monotonic status machinery is reusable (`launchContext.ts:598-660`).

#### `copilot-runtime-workspace`

1. Add a Happy publisher that:
   - consumes the already-built Happy artifact
   - copies it immutably into `happy/versions/<artifactId>`
   - publishes an exact release-set descriptor
   - writes COMPLETE last
   - advances the sequenced joint pointer atomically
2. Extend `EvCopilot.psm1` with:
   - release-set verification and local atomic extraction
   - config commands for route enable/disable/status/pin/rollback
   - `-NoHappy`
   - exact-PID terminal supervision
   - attach-context creation
   - mirror spawn and status/log handling
3. Preserve all current argument forwarding, proxy startup, edition environment, direct selection, and exit-code behavior.

#### Publication/acceptance

1. Build Happy from a clean exact commit.
2. Live-revalidate the pair against the intended EvCopilot artifact.
3. Do not assume ev.12 compatibility merely because its manifest carries `t6-happy-copilot-embedded-ui-server-remote-steering` (`OneDrive ...\manifest.json:77-83`).
4. Publish one joint release set.
5. Explicitly enable `happy.mode=route` on two already-paired machines.
6. Verify:
   - first install
   - cached offline launch
   - two simultaneous terminals
   - permission denial from phone
   - terminal exit cleanup
   - daemon-busy pending update
   - rollback
   - `-NoHappy`

No new EvCopilot product change is required in this phase if its existing embed/registry actor passes the fresh exact-pair E2E.

### Phase 2

- Add `happy.getProtocolInfo`.
- Add bounded one-time mirror restart after a post-ownership crash.
- Add deep doctor/repair and retention pruning.
- Add background staging of new release sets.
- Add signed channel/release-set metadata if the trust model is upgraded.

### Phase 3

- One-command new-machine bootstrap and pairing guidance.
- Better mobile indication of route/version mismatch.
- Optional automated idle-window promotion.
- Fleet diagnostics across all operator machines.

### Repository-boundary risks

- **Schema duplication:** the OneDrive release-set schema should be owned by `copilot-runtime-workspace`; Happy should consume only a small versioned launch-context schema.
- **Immutable manifest finalization:** the current Happy builder emits an empty exact-Ev compatibility list while the launch-context parser requires a non-empty one (`portable-artifact.cjs:1633-1640`; `launchContext.ts:148-160`). Do not patch an already-hashed artifact after building. Make the joint release set the pair authority.
- **Attach versus managed-server confusion:** current launch context is for Happy-owned managed-server launch, not terminal attachment (`runCopilotMirror.ts:202-204,337-355`).
- **EvCopilot manifest evolution:** the current OneDrive EvCopilot manifest is schema 1 (`OneDrive ...\manifest.json:1-16`), while Happy’s production context parser expects an EvCopilot schema-2 manifest with a `copilot.packageVersion` block (`launchContext.ts:92-111`). The publisher and consumer contracts must be aligned explicitly.
- **Cross-repo acceptance:** unit tests in either repository cannot substitute for a joint live test before pointer promotion.

---

## Disconfirming findings from the current code

1. **Several “future” primitives already exist.**  
   Codexu already contains a secure portable artifact builder and strict EvCopilot launch-context/daemon payload identity support. The completed task records report the builder and context work at commits `70558f6c` and `dac57e6d` (`.tasks-board/data.archived.json:13333-13342,13362-13372`).

2. **The current launch context does not support the desired terminal attach architecture.**  
   Attach and launch context are explicitly mutually exclusive (`commands/copilotCommand.ts:71-72`; `runCopilotMirror.ts:202-204`). With a launch context, Happy spawns a managed server instead of attaching to the operator’s terminal (`runCopilotMirror.ts:337-355`).

3. **The UI registry’s `copilotVersion` is presently unusable as an edition-compatibility gate.**  
   The live T6 entry is schema 1 and reports `"0.0.1"` (`~/.copilot/servers/22508.json:2,8`). Happy compares the actor response against that registry-supplied value (`nativeLocalRpcClient.ts:165-177`), so this proves only placeholder consistency.

4. **The currently built Happy artifact contract describes the wrong registry family for T6.**  
   The builder emits controller `registrySchema: 2` and package `1.0.71-3`, which describe the managed-server path, while T6 terminal attachment uses schema 1 (`portable-artifact.cjs:1633-1640`; `types.ts:7-9`; live registry above).

5. **The raw portable artifact is not immediately consumable by the current launch-context parser.**  
   The builder emits `compatibility.evCopilot: []` (`portable-artifact.cjs:1633-1640`), while the parser requires at least one exact compatible EvCopilot entry (`launchContext.ts:148-160`).

6. **The current OneDrive EvCopilot manifest is also not compatible with the launch-context parser.**  
   The live manifest is schema 1 and lacks the parser’s required `copilot.packageVersion`, executable, and fixed-argument block (`OneDrive ...\manifest.json:1-21`; `launchContext.ts:92-111`).

7. **Portable Node is not yet fully propagated to Happy’s children.**  
   Top-level execution can use the bundled Node, but `spawnHappyCLI` resolves `node` from `PATH` (`spawnHappyCLI.ts:89-112`). The existing portable test invokes only help before daemon startup, so it does not prove daemon hermeticity (`copilotCommand.ts:64-66,83-85`).

8. **A separate manual `happy daemon start` is no longer inherently necessary.**  
   `happy copilot` already calls `ensureDaemonRunning()` before starting the mirror (`copilotCommand.ts:83-92`).

9. **The current ev.12 artifact advertises T6 but has not thereby proven wire compatibility.**  
   Its manifest includes the T6 capability label (`OneDrive ...\manifest.json:77-83`), but capability presence cannot prove the previously drift-prone action/lease field contract.

---

## Open decisions only the operator can make

1. **Trust model:** retain unsigned owner-only SHA-256 publication for phase 1, or require a pinned Ed25519 signature on joint pointers and release sets.
2. **Activation UX:** keep the recommended one-time explicit `ev-copilot happy enable`, or auto-enable routing when the profile is installed.
3. **Busy-update policy:** keep launching the old exact routed pair until idle, or allow latest EvCopilot to launch route-less while a Happy set remains pending.
4. **Home identity:** accept the recommended shared `~/.happy`, or intentionally choose an EvCopilot-scoped home and re-pair every machine/device.
5. **First production pair:** revalidate and publish ev.12, or initially pin the historically verified ev.6 artifact.
6. **Background presentation:** hidden mirror with file-only logs, or a visible minimized process window for easier early diagnostics.

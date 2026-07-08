# Brainstorm: Restore the happy-app voice / realtime subsystem?

- **Task:** `happy-app-restore-voice-realtime-subsystem`
- **Worktree / branch:** `.worktrees/bs-voice-realtime` on `ralph/bs-voice-realtime` (off `main` @ `412f98502`)
- **Type:** READ-ONLY analysis. No code changes. One deliverable (this file).
- **Upstream reference for the removed code:** tag `cli-1.1.10` (`slopus/happy@71c417e1`).

---

## 1. Goal + honest framing

**Question:** the fork deleted upstream Happy's voice/realtime subsystem
(`packages/happy-app/sources/realtime/` — 12 files, ~1177 blob lines). Upstream's
AgentInput mic was restored **inert** in R8 stage 4 (HA-6). Should we functionally
restore voice, and if so how?

**Honest verdict up front: a *full* functional restore is architecturally hostile
to this fork, and is NOT worth it. "Keep-removed" is the recommended default.**
A narrow, bypass-only, e-ink-static "minimal restore" is the *only* acceptable
restore path, and only if the operator explicitly wants hands-free voice control
on the tablet. The reasons, in order of weight:

1. **It was central-server + monetization coupling — exactly what the fork
   deleted on purpose.** Upstream's voice flow brokers an ElevenLabs conversation
   token through a **central Happy server** route (`POST /v1/voice/conversations`),
   gated by RevenueCat `pro` entitlements, a "20 minutes free then pay" limit, and
   PostHog upsell A/B experiments. The fork has **no central server** (per-daemon
   embedded happy-server, single-user), and it removed the whole server voice route
   (Sprint E) and the client credential broker (`apiVoice.ts`, Sprint D). Restoring
   the credentialed path means re-introducing a central-server dependency the fork
   spent two sprints removing.

2. **It streams live microphone audio to ElevenLabs' cloud.** For a
   privacy-focused self-host fork, continuous mic → 3rd-party cloud egress is a
   material posture change and a per-minute billed cost. `docs/3dparty.md:8` lists
   ElevenLabs as the voice-synth 3rd party; `docs/experimental/roadmap.md:9` records
   the upstream intent to "start charging for voice." This is a paid, cloud, closed
   feature.

3. **It is e-ink hostile.** The upstream status bar (`VoiceAssistantStatusBar`)
   renders animated `VoiceBars` + a pulsing `StatusDot` + a VAD-driven
   `idle/agent-speaking/user-speaking` mode that changes continuously while anyone
   talks. Continuous repaints are precisely what the fork's e-ink target avoids.
   (Notably, *upstream itself* already hides the full bar on tablet and only shows a
   `sidebar` variant there — see §5.)

**Is a functional restore even viable?** Technically yes — but only via the
**bypass path** that already exists in the removed code. `RealtimeSession.ts`
supports a `voiceBypassToken + voiceCustomAgentId` mode that connects the client
**directly** to a user-owned **public ElevenLabs agent** with just an `agentId` —
no server route, no credential broker, no paywall. That single fact is what makes a
minimal restore feasible without resurrecting the central-server coupling.

---

## 2. The removed subsystem — the 12 files

Enumerated via `git ls-tree -r --name-only cli-1.1.10 -- packages/happy-app/sources/realtime`.

| # | File | ~lines | What it does | External / cross-module deps |
|---|------|-------:|--------------|------------------------------|
| 1 | `RealtimeProvider.tsx` | 19 | Mounts `<ElevenLabsProvider>` (native) + `<RealtimeVoiceSession>`; re-keys on `useVoiceSessionGeneration()` to force a fresh LiveKit `Room` between sessions. | `@elevenlabs/react-native`, `@/sync/storage` |
| 2 | `RealtimeProvider.web.tsx` | 14 | Web variant (no LiveKit; plain WebSocket). | `@/sync/storage` |
| 3 | `RealtimeSession.ts` | 184 | Session lifecycle: mic permission, **`fetchVoiceCredentials` server call**, RevenueCat paywall gating, PostHog upsell variant, **bypass mode** (agentId only), system-prompt + first-message build. Module-global singleton `voiceSession`. | `@/sync/apiVoice`, `@/sync/sync` (`presentPaywall`), `@/auth/tokenStorage`, `@/modal`, `@/text`, `@/utils/microphonePermissions`, `@/sync/storage`, `@/sync/persistence`, `./voiceSystemPrompt`, `./voiceExperiment` |
| 4 | `RealtimeVoiceSession.tsx` | 191 | Native `useConversation()` hook wiring: `onConnect/Disconnect/Error/ModeChange/VadScore`; VAD threshold logic; registers a `VoiceSession` impl. Renders `null`. | `@elevenlabs/react-native`, `@/sync/storage`, `@/constants/Languages`, `./realtimeClientTools`, `./RealtimeSession` |
| 5 | `RealtimeVoiceSession.web.tsx` | 185 | Web variant; `navigator.mediaDevices.getUserMedia` for mic, `@elevenlabs/react` `useConversation`. | `@elevenlabs/react`, same as #4 |
| 6 | `hooks/voiceHooks.ts` | 202 | Multi-session context bridge: `onSessionOnline/Offline/Focus`, `onPermissionRequested`, `onMessages`, `onReady`, `onVoiceStarted/Stopped`. Silent context vs. agent-triggering prompt channels; prompt queue flushed on `idle`. | `@/sync/storage`, `@/sync/typesMessage`, `../voiceConfig`, `./contextFormatters`, `../RealtimeSession` |
| 7 | `hooks/contextFormatters.ts` | 108 | Formats sessions / messages / permission requests / ready events into natural-language context strings for the agent. | `@/sync/storageTypes`, `@/sync/typesMessage`, `@/utils/trimIdent`, `../voiceConfig` |
| 8 | `realtimeClientTools.ts` | 84 | The two agent-callable **client tools**: `sendMessageToSession` (voice → `sync.sendMessage`) and `processPermissionRequest` (voice approve/deny of a session permission request). | `zod`, `@/sync/sync`, `@/sync/ops` (`sessionAllow/Deny`), `@/sync/storage`, `@/track`, `@/sync/persistence`, `./RealtimeSession` |
| 9 | `types.ts` | 17 | `VoiceSession`, `VoiceSessionConfig`, `ConversationStatus`, `ConversationMode` types. | none |
| 10 | `voiceConfig.ts` | 31 | Static feature flags (tool-call verbosity, history cap, debug logging). | none |
| 11 | `voiceExperiment.ts` | 78 | PostHog **upsell A/B** variant resolution + `applyVoiceUpsellOverride`. Pure monetization. | `@/track` |
| 12 | `voiceSystemPrompt.ts` | 64 | Agent system prompt ("You are a voice interface for Happy…") + paid-onboarding prompt + first-message builder. | none |

**External npm packages the subsystem needs (both ABSENT from the fork's
`package.json` today):**
- `@elevenlabs/react-native` — native SDK; uses **LiveKit / WebRTC** under the hood.
- `@elevenlabs/react` — web SDK; plain WebSocket.

---

## 3. Dependency + wiring analysis (what it needs vs. what the fork has)

### 3a. Cross-module deps that were ALSO removed and must be recreated

| Removed dependency | Status in fork | Evidence |
|---|---|---|
| `sources/sync/apiVoice.ts` (`fetchVoiceCredentials`, `fetchVoiceUsage`) | **REMOVED** (Sprint D US-006) | `docs/encryption.md:63`; guard `encryptionDeletion.spec.ts:66` forbids `apiVoice` in production files |
| `config.elevenLabsAgentId` (source of the agentId in `apiVoice`) | **REMOVED** (no `elevenLabs` key in `config`/`appConfig`) | grep of `sources/config.ts` / `sync/appConfig.ts` → no match |
| Storage realtime state: `realtimeStatus`, `realtimeMode`, `setRealtimeStatus/Mode`, `incrementVoiceSessionGeneration`, `useVoiceSessionGeneration`, `useRealtimeStatus`, `useRealtimeMode`, `clearRealtimeModeDebounce` + the debounce | **REMOVED** (HA-2a) | `sources/sync/storage.ts:219` `[KEEP-DELETED] … the realtimeMode debounce are deliberately absent` |
| `sources/sync/persistence.ts` voice counters (`getVoiceMessageCount`, `incrementVoiceMessageCount`, `getVoiceOnboardingPromptLoadCount`, `getVoiceSoftPaywallShownCount`, `incrementVoiceSoftPaywallShown`) | **REMOVED** | grep → no match in fork `persistence.ts` |
| `sources/components/VoiceAssistantStatusBar.tsx` | **REMOVED** | guard `encryptionDeletion.spec.ts:62` |
| `sources/components/VoiceBars.tsx` (animated bars) | **REMOVED** | `Test-Path` → ABSENT; guard forbids `VoiceBars` |
| `sources/utils/microphonePermissions.ts` | **REMOVED** | guard `encryptionDeletion.spec.ts:62` forbids `microphonePermissions` |
| Settings schema fields: `voiceBypassToken`, `voiceCustomAgentId`, `voiceAssistantLanguage`, `voiceUpsellOverride` | **REMOVED** | grep → only the guard-spec regex matches |
| Server route `POST /v1/voice/conversations` (`voiceRoutes`) | **REMOVED** (Sprint E) — "former routes must return 404" | `docs/api.md:12,94`; `docs/backend-architecture.md:153`; `packages/happy-server/sources/fork/registerForkRoutes.ts:1` lists `voiceRoutes` in the KEEP-DELETED allowlist |

### 3b. Cross-module deps that SURVIVE (the good news)

| Surviving dependency | Status | Evidence |
|---|---|---|
| happy-wire `voice.ts` schemas (`VoiceConversationResponseSchema`, granted/denied union, `VoiceUsageResponseSchema`) | **RETAINED** | `packages/happy-wire/src/voice.ts:3-36`, exported from `index.ts:5` |
| `sources/constants/Languages.ts` `getElevenLabsCodeFromPreference` + `ElevenLabsLanguage` | **RETAINED** | `Languages.ts:1-13` |
| PostHog tracking (`@/track`) | **RETAINED** (`track/` dir present) | `sources/track/` exists; `posthog-react-native` in `package.json:134` |
| RevenueCat `sync.presentPaywall` + `react-native-purchases*` deps | **RETAINED** (used for `'voluntary_support'` donations, not voice gating) | `SettingsView.tsx:82`, `sources/sync/revenueCat/revenueCat.ts:77`; `package.json:66,146-147` |
| AgentInput mic affordance (props `onMicPress?`/`isMicActive?`, voice icon seam) | **RESTORED but INERT** (HA-6, R8 stage 4) | `components/AgentInput.tsx:106-109,726-728,1741`; `fork/agentInput/voiceIcon.ts`; `docs/happy-patch-surface.md:734-747` |

### 3c. The gap to "functional"

The mic button is wired to call `props.onMicPress()` (AgentInput.tsx:726-728), but
**no parent passes `onMicPress`** — the fork's `SessionView` does not import
`@/realtime/*` and leaves the handler undefined
(`docs/happy-patch-surface.md:837-840`). To make it functional you must:

1. **Client transport:** restore `sources/realtime/*` (the parts you keep — see §6b),
   add `@elevenlabs/react-native` + `@elevenlabs/react`.
2. **Storage state:** re-add `realtimeStatus`/`realtimeMode` (+ setters/hooks) to the
   single-user store. (You can drop the animated-debounce complexity.)
3. **Settings:** re-add at least `voiceCustomAgentId` (+ optional
   `voiceAssistantLanguage`) so the user can point at their own ElevenLabs agent.
4. **UI status:** provide a status surface (recreate `VoiceAssistantStatusBar`, or a
   **static** e-ink-safe replacement).
5. **Wiring:** wrap the app tree in `<RealtimeProvider>` in `app/_layout.tsx`; wire
   `handleMicrophonePress` → `onMicPress` in `SessionView` (HA-4).
6. **Credentials:** EITHER re-add the server `/v1/voice/conversations` route + an
   ElevenLabs API key on the daemon (full path) **OR** use bypass mode with a
   user-owned public agent (minimal path — no server).
7. **Guard test:** relax/scope `encryptionDeletion.spec.ts` — the `'has no voice or
   realtime production surfaces'` assertion will FAIL the instant any restore lands.

---

## 4. Why the fork removed it (cited)

The removal was **not** a standalone decision — it was one strand of the systematic
Sprint D/E deletion of upstream's central-server, multi-tenant, and monetization
coupling:

- **Server voice route deleted (Sprint E).** `docs/api.md:12` — "Sprint E removed the
  legacy artifact, feed, **voice**, key-value, access-key, user, friends, usage, and
  machine-directory route modules from happy-server." `docs/api.md:94` — "Their former
  routes must return 404." `docs/backend-architecture.md:153` confirms the same.
- **Client credential broker + encryption deleted (Sprint D).** `docs/encryption.md:63`
  — "their callers (`apiArtifacts.ts`, `apiKv.ts`, `apiUsage.ts`, `apiServices.ts`,
  `apiFeed.ts`) were deleted in Sprint D (US-006)." `apiVoice.ts` went with that cohort.
- **Multi-account store + realtime debounce deleted (HA-2a).**
  `sources/sync/storage.ts:219` — the `realtimeMode` debounce is "deliberately absent
  from this single-user store."
- **A guard test actively enforces the absence.**
  `sources/sync/encryptionDeletion.spec.ts:62` asserts **zero** production references to
  `voiceHooks|RealtimeProvider|RealtimeVoiceSession|RealtimeSession|VoiceAssistantStatusBar|VoiceBars|…|@/realtime/|\bvoice\b`.
  The subsystem is not merely deleted; re-adding it is a deliberate, test-visible act.
- **The mic UI was intentionally left as a door, not a feature.**
  `docs/happy-patch-surface.md:746-747` — "This is **UI-only** — the voice
  runtime/permission plumbing lives in the caller … so mic/voice is
  **inert-but-present** until a parent wires `onMicPress`." Line 839-840 — "a full
  voice-runtime restore is a separate follow-up." That "separate follow-up" is *this*
  task.
- **Underlying motives:** central-server elimination (fork has no central server),
  privacy/self-host posture (no 3rd-party cloud audio egress by default), cost (voice
  was slated to be a **paid** feature — `docs/experimental/roadmap.md:9`), and e-ink
  UX (no continuous-repaint animated status bar).

---

## 5. e-ink placement

**Upstream already treats the tablet as a special case** — the sidebar *is* the
intended tablet placement:

- `SessionView.tsx` (upstream): `{/* Voice status bar below header - not on tablet
  (shown in sidebar) */} {!isTablet && realtimeStatus !== 'disconnected' && (
  <VoiceAssistantStatusBar variant="full" /> )}`. On tablet the full-width bar is
  suppressed; the `sidebar` variant renders in the collapsible sidebar instead.
- `VoiceAssistantStatusBar` already ships a `variant?: 'full' | 'sidebar'` prop, so the
  sidebar slot is a first-class rendering path, not a new invention.

**But the *content* of that bar is e-ink hostile as written:** it composes animated
`VoiceBars` (continuously animating amplitude bars while speaking) + a pulsing
`StatusDot` (`isPulsing: true` during `connecting`) + VAD-driven mode flips
(`idle → user-speaking → agent-speaking`) that repaint on every speech transition.

**Recommendation for placement + treatment:**
- Placement: reuse upstream's tablet convention — a compact **sidebar** row, full-width
  bar suppressed on tablet.
- Treatment: replace `VoiceBars` + pulsing dot with a **static** status row (plain text
  + a static icon, no animation): e.g. "Voice: connecting…" / "Voice: active — tap to
  stop" / "Voice: error". Static-only matches the fork's `context-boundary`/BoundaryDivider
  e-ink discipline ("Keep all boundary UI static for the e-ink tablet target").
- Gate the entire feature behind a **default-OFF** `enableVoiceAssistant` local setting
  (fork convention: opt-in features default `false` so non-e-ink users and the common
  case are unaffected).

---

## 6. Options + recommendation

### Option (a) — FULL restore

Restore all 12 files verbatim + `apiVoice.ts` + a re-added server
`/v1/voice/conversations` route (with an ElevenLabs API key on the daemon) +
`VoiceAssistantStatusBar` + `VoiceBars` + storage realtime state + persistence
counters + the paywall/upsell/experiment machinery + the settings fields, wired via
`_layout` + `SessionView`.

- **Effort:** HIGH (7 removed dependency files/areas + server route + wire + config +
  settings + storage + 2 npm deps; plus guard-test surgery).
- **Conflict surface:** HUGE. Re-introduces a Sprint-D/E-deleted subsystem across
  happy-app **and** happy-server, directly against a guard test, and re-couples the app
  to a central-server credential broker + RevenueCat entitlements.
- **e-ink fit:** POOR (animated bars, pulsing dot).
- **Infra:** server ElevenLabs API key + configured conversational agent + credential
  broker route + (upstream's) paywall/entitlement logic.
- **Verdict:** ❌ **Rejected.** Resurrects exactly the central-server + monetization
  coupling the fork deliberately removed, for a paid cloud feature on a reading tablet.

### Option (b) — MINIMAL restore (bypass-only, push-to-talk, e-ink-static, default-off)

Restore only the transport core and drive it entirely through **bypass mode** (a
user-owned **public ElevenLabs agent**, `agentId` only — no server, no paywall). Keep:
`RealtimeProvider(.web)`, `RealtimeVoiceSession(.web)`, `types.ts`, `voiceConfig.ts`,
`realtimeClientTools.ts`, `hooks/voiceHooks.ts`, `hooks/contextFormatters.ts`,
`voiceSystemPrompt.ts` (trim the paid-onboarding block), and a **trimmed**
`RealtimeSession.ts` (bypass path only — delete the `fetchVoiceCredentials` / paywall /
upsell branches). **Drop:** `apiVoice.ts`, `voiceExperiment.ts`, the server route, the
persistence counters, and the paywall/entitlement gating. Add a minimal storage
`realtimeStatus`/`realtimeMode` (no animated debounce), a `voiceCustomAgentId` (+ optional
`voiceAssistantLanguage`) setting, a **static** status row (no `VoiceBars`), a minimal
`microphonePermissions` helper, and a default-off `enableVoiceAssistant` toggle. Wire
mic → `onMicPress` in `SessionView`, wrap the tree in `<RealtimeProvider>` gated by the
toggle.

- **Effort:** MEDIUM. Mostly self-contained under `sources/realtime/` + one settings
  field + one toggle + one static status component + the two wiring seams.
- **Conflict surface:** MODERATE and app-only (no happy-server change, no wire change —
  `voice.ts` schemas are unused in bypass mode). Still needs the guard-test scoping.
- **e-ink fit:** ACCEPTABLE (static status, default-off, opt-in).
- **Infra:** **NONE server-side.** User brings their own public ElevenLabs agent id.
  Audio still egresses to ElevenLabs cloud (operator privacy call) and is billed to the
  user's own ElevenLabs account (operator cost call).
- **Verdict:** ✅ The **only** acceptable restore path — *if* the operator wants voice.

### Option (c) — KEEP-REMOVED (do nothing beyond the inert mic)

Leave the mic affordance inert (as HA-6 already ships). The door stays open; no cost, no
privacy change, no e-ink regression, no guard-test churn.

- **Effort:** ZERO.
- **Verdict:** ✅ **Recommended default.**

### Recommendation

**Default to (c) keep-removed.** Voice/realtime is a paid, cloud, animated, central-server-
oriented feature that is misaligned with an e-ink, self-host, no-central-server reading
tablet, and the mic UI is *already* present-but-inert so nothing is lost by waiting.
**Adopt (b) minimal bypass-only restore ONLY if the operator explicitly wants hands-free
voice control on the tablet** and accepts the ElevenLabs cloud/cost trade-offs. **Reject
(a) full restore** outright. The decision is an operator call (see §7), not a technical
blocker — bypass mode makes (b) genuinely feasible without a server.

---

## 7. If restore is recommended: the intake recipe (Option b)

**Files to restore from `cli-1.1.10` (into `packages/happy-app/sources/realtime/`):**
- `RealtimeProvider.tsx`, `RealtimeProvider.web.tsx` — verbatim.
- `RealtimeVoiceSession.tsx`, `RealtimeVoiceSession.web.tsx` — verbatim.
- `types.ts`, `voiceConfig.ts` — verbatim.
- `realtimeClientTools.ts` — verbatim (keep the `sendMessageToSession` +
  `processPermissionRequest` tools; drop the `incrementVoiceMessageCount` counter calls).
- `hooks/voiceHooks.ts`, `hooks/contextFormatters.ts` — verbatim.
- `voiceSystemPrompt.ts` — restore but **delete** the `PAID_VOICE_ONBOARDING_PROMPT`
  block and `includePaidVoiceOnboarding` branch.
- `RealtimeSession.ts` — **trim to bypass-only:** keep `registerVoiceSession`,
  `startRealtimeSession`, `stopRealtimeSession`, and the module-global state; **delete**
  the `fetchVoiceCredentials` call, the `presentPaywall`/entitlement gating, the
  `getVoiceUpsellVariant` logic, and the persistence-counter reads. Start a session with
  just `{ sessionId, initialContext, agentId: settings.voiceCustomAgentId }`.

**Files to DROP (do not restore):** `voiceExperiment.ts`, `apiVoice.ts` (never re-add),
`VoiceBars.tsx`.

**Dependency files to (re)create in the fork:**
- Minimal `sources/utils/microphonePermissions.ts` (native `requestMicrophonePermission`
  + web `getUserMedia`). Guard-forbidden today — see guard note below.
- Minimal storage state in `sources/sync/storage.ts`: `realtimeStatus`, `realtimeMode`,
  `setRealtimeStatus`, `setRealtimeMode`, `incrementVoiceSessionGeneration`,
  `useVoiceSessionGeneration`, `useRealtimeStatus`, `useRealtimeMode`. Skip the animated
  `clearRealtimeModeDebounce` complexity — a plain setter is enough for a static UI.
- A **static** `VoiceAssistantStatusBar` (text + static icon; `variant 'full' | 'sidebar'`;
  no `VoiceBars`, no pulsing).
- Settings additions: `voiceCustomAgentId: string`, optional `voiceAssistantLanguage`,
  and a local `enableVoiceAssistant: boolean` (default **false**).

**Deps to add (`packages/happy-app/package.json`):** `@elevenlabs/react-native` and
`@elevenlabs/react` (pull upstream's pinned versions from `cli-1.1.10`). Note the native
SDK pulls LiveKit/WebRTC transitively → verify the Expo/Metro + Windows Gradle build
(this fork does not run `prebuild`; native modules must be checked against
`packages/happy-app/AGENTS.md` "Android over-WiFi" build constraints).

**Server support needed:** **NONE** in bypass mode — that is the whole point of Option
(b). Do NOT re-add `/v1/voice/conversations`. (Full mode would need it back + an
ElevenLabs API key on each daemon; explicitly out of scope for (b).)

**Wiring:**
- `app/_layout.tsx`: wrap the app subtree in `<RealtimeProvider>`, gated by
  `enableVoiceAssistant`. (Upstream also called `applyVoiceUpsellOverride` here — DROP
  it.)
- `sources/-session/SessionView.tsx` (HA-4): add `handleMicrophonePress`
  (`voiceHooks.onVoiceStarted(sessionId)` → `startRealtimeSession(...)`;
  `stopRealtimeSession()` + `voiceHooks.onVoiceStopped()` on toggle-off); pass
  `onMicPress` + `isMicActive` to `<AgentInput>`; mount the static
  `<VoiceAssistantStatusBar>` (full for phone, sidebar for tablet, both gated by the
  toggle).

**Guard-test change (do not miss):** `sources/sync/encryptionDeletion.spec.ts` — the
`'has no voice or realtime production surfaces'` assertion (line ~62) will fail the moment
any restored file lands. Scope it to the restored surfaces (or remove the voice clause and
keep the encryption/monetization clauses), and remove `microphonePermissions` from the
forbidden set. Treat this as a first-class story, not an afterthought.

**Guard/verification tests to add:**
- Render test: mic present + `onMicPress` wired ⇒ tapping an empty composer starts a
  session (mock `startRealtimeSession`).
- Static-UI test: `VoiceAssistantStatusBar` renders no animated `VoiceBars` and no
  pulsing dot (e-ink invariant).
- Default-off test: with `enableVoiceAssistant=false`, `RealtimeProvider` is not mounted
  and `onMicPress` is undefined (mic stays inert) — preserves the current behavior for
  everyone who does not opt in.
- Typecheck: `pnpm --filter happy-app typecheck`.

### Operator-decision calls (flag before any implementation)

1. **Do you want voice at all on an e-ink reading tablet?** If no → Option (c), done.
2. **ElevenLabs cloud audio egress (privacy).** Bypass mode still streams live mic audio
   to ElevenLabs' servers. Acceptable for the self-host privacy posture?
3. **Cost.** ElevenLabs Conversational AI is billed per minute. In bypass mode the bill
   lands on the *user's own* ElevenLabs account (they supply the agent id) — confirm
   that's the intended model vs. a shared/operator agent.
4. **Add the `@elevenlabs/*` deps?** Two new native deps (LiveKit/WebRTC transitive) on a
   fork that hand-maintains its Android build without `prebuild`. Worth the build-surface
   risk for a default-off feature?
5. **Full vs. bypass.** Confirm bypass-only (no server route) is acceptable — i.e. the
   user configures a public ElevenLabs agent id in settings rather than the app brokering
   a credential through the daemon.

---

## Appendix — key file:line citations

- Removed 12 files: `git ls-tree -r --name-only cli-1.1.10 -- packages/happy-app/sources/realtime`
- Removal rationale: `docs/api.md:12,94`; `docs/backend-architecture.md:153`;
  `docs/encryption.md:63`; `docs/experimental/roadmap.md:9`; `docs/3dparty.md:8`
- Guard test: `packages/happy-app/sources/sync/encryptionDeletion.spec.ts:62,66`
- Storage removal: `packages/happy-app/sources/sync/storage.ts:219`
- Server route KEEP-DELETED: `packages/happy-server/sources/fork/registerForkRoutes.ts:1`
- Inert mic / HA-6: `packages/happy-app/sources/components/AgentInput.tsx:106-109,726-728,1741`;
  `packages/happy-app/sources/fork/agentInput/voiceIcon.ts`;
  `docs/happy-patch-surface.md:227,734-747,837-840`
- Surviving wire schemas: `packages/happy-wire/src/voice.ts:3-36`, `index.ts:5`
- Surviving Languages helper: `packages/happy-app/sources/constants/Languages.ts:1-13`
- Surviving RevenueCat: `packages/happy-app/sources/sync/revenueCat/revenueCat.ts:77`;
  `packages/happy-app/sources/components/SettingsView.tsx:82`; `package.json:66,146-147`
- Upstream mount points: `cli-1.1.10:packages/happy-app/sources/app/_layout.tsx`
  (`<RealtimeProvider>`); `cli-1.1.10:packages/happy-app/sources/-session/SessionView.tsx`
  (`handleMicrophonePress`, `onMicPress`, `VoiceAssistantStatusBar variant`)

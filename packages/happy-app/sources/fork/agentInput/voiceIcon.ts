/**
 * FORK PATCH: [RESTORE-R8c] AgentInput voice-mic icon accessor (invariant HA-6).
 *
 * Fork-owned seam for the upstream mic/voice affordance's icon asset. Upstream
 * cli-1.1.10 loads this icon inline in the send-button JSX via
 * `require('@/assets/images/icon-voice-white.png')`. That inline `require()` is
 * left untransformed by esbuild, so under the Vitest node runner it is executed
 * by Node's CommonJS `createRequire`, which cannot resolve the `@/` Vite alias
 * or a `.png` asset — and `vi.mock('@/assets/...png')` only intercepts ESM
 * imports, never a raw inline `require()`. Relocating the asset load behind this
 * ESM module boundary lets the AgentInput render tests mock a real module
 * (`vi.mock('../fork/agentInput/voiceIcon', ...)`) deterministically, while the
 * Metro/Expo runtime resolves the asset normally.
 *
 * The accessor is lazy so that merely importing AgentInput.tsx (without rendering
 * the voice branch) never triggers the asset `require()` in the test runner.
 * Behavior is unchanged from upstream: the same asset backs the same affordance.
 * The return type mirrors upstream's inline `require(...)` (implicitly `any`) so it
 * stays assignable to expo-image's `Image` `source` prop without a cast.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getVoiceMicIcon(): any {
    return require('@/assets/images/icon-voice-white.png');
}

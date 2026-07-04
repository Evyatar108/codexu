// FORK PATCH: [RESTORE-R1a-done] api.ts auth-decorator + public-mode wiring relocated out of configureApi into a fork-owned seam (invariants HS-1, HS-2)
//
// Fork-owned auth plane for the single-user happy-server. This seam holds the
// fork's entire auth-decorator wiring so the upstream-canonical `api.ts`
// `configureApi` body returns close to canonical shape and stops being a
// merge-conflict hotspot. Pure relocation from `api.ts` (M1-R1a) — NO behavior
// change. See docs/happy-patch-surface.md (HS-1 auth-decorator wiring, HS-2
// public-mode fail-closed boundary).
//
// What lives here (moved verbatim from configureApi):
//   - the no-op `authenticateTunnel` decorator (tunnel identity collapses to
//     tofuConfig.localUserId — single-user posture, NO per-request userId),
//   - the mode-selecting `authenticate` decorator
//     (`options.auth === "loopback" ? verifyLoopbackCapability : authenticateTunnel`),
//   - the ENTIRE public-mode block: the throw-if-`publicAuth`-missing guard, the
//     `parseAs:'buffer'` content-type parser that captures `request.rawBody`, the
//     `onRequest` `httpGuard`, and the `preValidation` `bodyHashGuard`.
//
// INSTALL-ORDER CONTRACT (load-bearing — US-005 default-deny depends on it):
// the caller invokes this seam BEFORE registering any route or the socket
// handler, so the public-mode `onRequest` httpGuard is installed ahead of every
// route (default-deny) and the `parseAs:'buffer'` parser + `preValidation`
// bodyHashGuard install in the same relative order as before the relocation.
import type { createApi, ConfigureApiOptions, TofuHandshakeConfig } from "../api";
import type { Fastify } from "../types";
import { createPublicAuthRuntime, type PublicAuthRuntime } from "./remoteDeviceAuth";

export interface ForkAuthPlaneResult {
    /** The public-mode runtime, or undefined outside public mode. Threaded by the
     *  caller into `startSocket` and `pairRoutes` exactly as before the relocation. */
    publicAuthRuntime?: PublicAuthRuntime;
}

/**
 * Install the fork's single-user + public auth plane onto the Fastify app.
 *
 * Behavior-preserving relocation of the auth wiring that previously lived inline
 * in `configureApi`. Must be called at the same position (after
 * `verifyLoopbackCapability` is decorated, before any route/socket registration)
 * so the hook install order — and therefore the fail-closed default-deny — is
 * identical to the pre-relocation code.
 */
export function installForkAuthPlane(
    fastifyApp: ReturnType<typeof createApi>,
    typed: Fastify,
    tofuConfig: TofuHandshakeConfig,
    options: ConfigureApiOptions,
): ForkAuthPlaneResult {
    void tofuConfig;

    // FORK PATCH: [RESTORE-R1a-done] no-op tunnel authenticator + mode-selecting `authenticate` — fork single-user auth plane; NO per-request userId (invariant HS-1)
    typed.decorate('authenticateTunnel', async function (_request: any) {});
    typed.decorate('authenticate', options.auth === "loopback" ? typed.verifyLoopbackCapability : typed.authenticateTunnel);

    // Fail-closed public-mode boundary. Installed BEFORE any public route is
    // registered so every method/path is denied (401) unless it appears in the
    // explicit policy allowlist with a valid device proof (or is /pair/complete
    // inside the operator pairing window). This is the application-layer boundary
    // for public internet exposure; the default tunnel/loopback paths are untouched.
    // FORK PATCH: [RESTORE-R1a-done] public-mode fail-closed boundary: buffer parser (captures rawBody) + onRequest httpGuard + preValidation bodyHashGuard; install order load-bearing for US-005 default-deny (invariant HS-2)
    let publicAuthRuntime: PublicAuthRuntime | undefined;
    if (options.auth === "public") {
        if (!options.publicAuth) {
            throw new Error('CRITICAL: auth "public" requires a publicAuth verifier + edge configuration. Refusing to configure a public listener without a fail-closed device verifier.');
        }
        publicAuthRuntime = createPublicAuthRuntime(options.publicAuth);
        // Capture the EXACT raw body bytes the client hashed so the signed bodyHash
        // can be enforced by the preValidation bodyHashGuard. parseAs:'buffer' hands
        // us the raw bytes; we still JSON.parse them ourselves so route handlers
        // receive the parsed object they expect (verified in tests). We deliberately
        // do NOT re-serialize the parsed JSON to hash it — canonicalization drift
        // between client and server would cause false rejections; only the bytes on
        // the wire are authoritative. This override applies to public mode only.
        fastifyApp.addContentTypeParser('application/json', { parseAs: 'buffer' }, function (request: any, body: Buffer, done: (err: Error | null, body?: unknown) => void) {
            request.rawBody = body;
            if (body.length === 0) {
                done(null, undefined);
                return;
            }
            try {
                done(null, JSON.parse(body.toString('utf8')));
            } catch (err) {
                (err as any).statusCode = 400;
                done(err as Error, undefined);
            }
        });
        fastifyApp.addHook('onRequest', publicAuthRuntime.httpGuard);
        fastifyApp.addHook('preValidation', publicAuthRuntime.bodyHashGuard);
    }

    return { publicAuthRuntime };
}

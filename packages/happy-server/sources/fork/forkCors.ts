// FORK PATCH: [KEEP] fork CORS policy relocated out of configureApi into a fork-owned seam — origin allowlist (parseCorsOrigins) + explicit header allowlist incl. device-proof/pairing headers, EXCLUDING edge-injected Cf-Access-Jwt-Assertion; pure relocation, behavior-preserving (invariant HS-7)
//
// Fork-owned CORS seam for the single-user happy-server. Holds the fork's CORS
// registration so the upstream-canonical `api.ts` `configureApi` body stops
// diverging on the header allowlist. Pure relocation from `configureApi` — NO
// behavior change. See docs/happy-patch-surface.md (HS-7). The socket plane keeps
// its own parseCorsOrigins()-based CORS config in `app/api/socket.ts`.
import type { createApi } from "@/app/api/api";
import { parseCorsOrigins } from "@/app/api/utils/parseCorsOrigins";

/**
 * Register the fork's CORS policy on the raw Fastify app.
 *
 * Behavior-preserving relocation of the `@fastify/cors` registration that
 * previously lived inline at the top of `configureApi`. Must be called at the
 * same position (before route registration) so preflight behavior is identical.
 */
export function installForkCors(fastifyApp: ReturnType<typeof createApi>) {
    const allowedOrigins = parseCorsOrigins();
    fastifyApp.register(import('@fastify/cors'), {
        origin: allowedOrigins.length === 0 ? false : allowedOrigins,
        // NOTE: `Cf-Access-Jwt-Assertion` is deliberately NOT listed. Cloudflare
        // Access INJECTS that header between its edge and the origin; a browser
        // never sends it, so it must not appear in the preflight allowlist. The
        // pairing headers below ARE browser-sent (POST /pair/complete).
        allowedHeaders: ['X-Tunnel-Authorization', 'X-Loopback-Capability', 'X-Happy-Client', 'Content-Type', 'X-Happy-Device-Proof', 'X-Happy-Pairing-Secret', 'X-Happy-Pairing-Nonce', 'CF-Access-Client-Id', 'CF-Access-Client-Secret'],
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    });
}

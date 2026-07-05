// FORK PATCH: [RESTORE-R3-done] operator-identity bind gate relocated out of index.ts into fork-owned seam (invariant HS-5)
//
// Fork-owned bind-host operator-identity gate. This is the single-user server's
// core safety rail: it refuses a non-loopback bind unless the process is in
// public mode with a fail-closed device verifier AND a Cloudflare Access edge
// expectation. Extracted from index.ts (M1-R3) as the first fork/ seam — pure
// relocation, no behavior change. See docs/happy-patch-surface.md (HS-5).
import type { CreateAppConfig } from "../index";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "localhost"]);

export function isLoopbackHost(host: string | undefined): boolean {
    if (!host) {
        return true;
    }
    return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function assertOperatorIdentityGate(config: Pick<CreateAppConfig, "auth" | "host" | "publicAuth">): void {
    const resolvedHost = config.host || "127.0.0.1";
    const boundToPublicHost = !isLoopbackHost(resolvedHost);

    if (config.auth === "public") {
        // Public mode is the ONLY mode permitted to bind a non-loopback host, and
        // only when a fail-closed device verifier AND an edge-auth expectation are
        // present. A "bare" public bind — public mode on a public host without any
        // paired device or without a Cloudflare Access service token — is refused,
        // because it would expose routes with no working application-layer boundary.
        if (boundToPublicHost) {
            const hasVerifier = !!config.publicAuth && config.publicAuth.devices.length > 0;
            const hasEdgeExpectation = !!config.publicAuth && config.publicAuth.edge.serviceTokens.length > 0;
            // The edge boundary that actually survives real Cloudflare Access is the
            // signed `Cf-Access-Jwt-Assertion` JWT (CF strips the service-token
            // headers before the origin). Require the assertion config — team domain
            // + application AUD — so a public bind cannot start with an edge check
            // that can never pass. A missing/typo'd assertion config fails fast here
            // rather than silently denying every request in production.
            const assertion = config.publicAuth?.edge.assertion;
            const hasAssertionExpectation = !!assertion && !!assertion.teamDomain && !!assertion.appAud;
            if (!hasVerifier || !hasEdgeExpectation || !hasAssertionExpectation) {
                const message = `CRITICAL: refusing to start happy-server public listener bound to non-loopback host "${resolvedHost}" without a fail-closed device verifier AND a Cloudflare Access edge expectation (service tokens + a verifiable Cf-Access-Jwt-Assertion config). Configure publicAuth.devices (at least one paired device), publicAuth.edge.serviceTokens, and publicAuth.edge.assertion.teamDomain + .appAud before binding a public host.`;
                console.error(message);
                throw new Error(message);
            }
        }
        return;
    }

    if (config.auth !== "loopback" && boundToPublicHost) {
        const message = `CRITICAL: refusing to start happy-server tunnel listener bound to non-loopback host "${resolvedHost}". The tunnel listener collapses identity to tofuConfig.localUserId and relies on the Dev Tunnels gateway plus a loopback bind as its operator identity gate. Bind to 127.0.0.1 (or set auth: "loopback") instead.`;
        console.error(message);
        throw new Error(message);
    }
}

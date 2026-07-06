// FORK PATCH: [KEEP-DELETED] curated single-user route surface relocated out of configureApi into a fork-owned seam — this IS the fork route allowlist; upstream's removed route files (accessKeysRoutes/artifactsRoutes/attachmentRoutes/authRoutes/connectRoutes/feedRoutes/kvRoutes/userRoutes/voiceRoutes + multi-machine machinesRoutes) stay REMOVED; pure relocation, behavior-preserving (invariant HS-7)
//
// Fork-owned route-registration seam for the single-user happy-server. Holds the
// EXACT fork route set so the upstream-canonical `api.ts` `configureApi` body
// stops being a merge-conflict hotspot on the route allowlist. Pure relocation
// from `configureApi` — NO behavior change (identical routes on identical
// listeners; tunnel-vs-loopback gating unchanged). See
// docs/happy-patch-surface.md (HS-7 route allowlist).
//
// INSTALL-ORDER CONTRACT (load-bearing — US-005 default-deny depends on it): the
// caller invokes `installForkAuthPlane(...)` BEFORE this seam, so the public-mode
// `onRequest` httpGuard is installed ahead of every route registered here
// (default-deny). No route is added to the public surface without a policy.
import type { createApi, ConfigureApiOptions, TofuHandshakeConfig } from "@/app/api/api";
import type { Fastify } from "@/app/api/types";
import type { EventRouter } from "@/app/events/eventRouter";
import type { PublicAuthRuntime } from "@/app/api/auth/remoteDeviceAuth";
import { accountRoutes } from "@/app/api/routes/accountRoutes";
import { machineSelfRoutes } from "@/app/api/routes/machineSelfRoutes";
import { pairRoutes } from "@/app/api/routes/pairRoutes";
import { pushRoutes } from "@/app/api/routes/pushRoutes";
import { sessionRoutes } from "@/app/api/routes/sessionRoutes";
import { devRoutes } from "@/app/api/routes/devRoutes";
import { versionRoutes } from "@/app/api/routes/versionRoutes";
import { v3SessionRoutes } from "@/app/api/routes/v3SessionRoutes";

/**
 * Register the fork's curated single-user route surface on the typed app.
 *
 * Behavior-preserving relocation of the route-registration block that previously
 * lived at the bottom of `configureApi`. Called AFTER `installForkAuthPlane` and
 * `startSocket`, at the same position and with the same arguments, so the routes
 * registered — and their tunnel-vs-loopback availability — are identical.
 */
export function registerForkRoutes(
    typed: Fastify,
    eventRouter: EventRouter,
    tofuConfig: TofuHandshakeConfig,
    options: ConfigureApiOptions,
    publicAuthRuntime: PublicAuthRuntime | undefined,
) {
    // Routes available on both tunnel and loopback listeners
    accountRoutes(typed, { paths: options.paths });
    machineSelfRoutes(typed, { machineState: options.machineState });

    // Routes only available on the tunnel listener (not loopback)
    if (options.auth !== "loopback") {
        pairRoutes(typed, tofuConfig, options.paths, {
            publicMode: options.auth === "public",
            pairingGate: publicAuthRuntime?.pairingGate,
            enrollDevice: publicAuthRuntime?.enrollDevice,
        });
        pushRoutes(typed, tofuConfig);
        sessionRoutes(typed, eventRouter, { localMachineId: tofuConfig.localUserId });
        devRoutes(typed);
        versionRoutes(typed);
        v3SessionRoutes(typed, eventRouter);
    }
}

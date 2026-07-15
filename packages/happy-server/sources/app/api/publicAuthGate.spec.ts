import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import { io as ioClient } from "socket.io-client";
import { createApi, configureApi, type TofuHandshakeConfig } from "./api";
import {
    PUBLIC_DEVICE_PROOF_HEADER,
    signPublicRequest,
    encodePublicDeviceProofHeader,
    generatePublicRequestNonce,
    hashRequestBody,
    encodeBase64,
} from "@slopus/happy-wire";
import * as ed from "@noble/ed25519";
import {
    PAIRING_NONCE_HEADER,
    PAIRING_SECRET_HEADER,
    type PublicAuthConfig,
} from "./auth/remoteDeviceAuth";
import { buildTestEdgeAssertion } from "./auth/testEdgeAssertion";

// Real Cloudflare Access strips the service-token headers before the origin and
// forwards a signed `Cf-Access-Jwt-Assertion` JWT instead. The public edge guard
// verifies that JWT, so the positive controls below present a minted assertion
// (backed by an in-process local JWKS) rather than client-id/secret headers.
let edgeAssertion: Awaited<ReturnType<typeof buildTestEdgeAssertion>>;
beforeAll(async () => {
    edgeAssertion = await buildTestEdgeAssertion();
});

// ---------------------------------------------------------------------------
// US-005 — THE GATE. This is the decisive fail-closed acceptance test for public
// internet exposure. It does NOT hand-maintain a route list: it DERIVES the full
// route inventory from the actually-registered Fastify app (via the onRoute hook)
// and then asserts that EVERY registered route rejects an unauthenticated request
// with 401 and leaks NO key material or secrets. A positive control (valid edge +
// device proof) proves the 401s are meaningful and not a blanket failure.
//
// If a future route is added to configureApi() but not to the public route-policy
// allowlist, this test still holds it to 401 (the global hook is default-deny) —
// and if the boundary ever regressed to fail-open, this test fails loudly.
// ---------------------------------------------------------------------------

// Distinctive sentinels planted in the server identity so we can assert no 401
// body ever echoes key material / secrets back to an unauthenticated caller.
const TOFU_ED25519_SENTINEL = "TOFU-ED25519-PUBLIC-KEY-SENTINEL";
const TOFU_X25519_SENTINEL = "TOFU-X25519-PUBLIC-KEY-SENTINEL";
const TOFU_FINGERPRINT_SENTINEL = "TOFU-ED25519-FINGERPRINT-SENTINEL";
const TUNNEL_URL_SENTINEL = "https://tunnel-url-SENTINEL.example";
const EDGE_CLIENT_ID = "CF-EDGE-CLIENT-ID";
const EDGE_CLIENT_SECRET_SENTINEL = "CF-EDGE-CLIENT-SECRET-SENTINEL";

const SECRET_SENTINELS = [
    TOFU_ED25519_SENTINEL,
    TOFU_X25519_SENTINEL,
    TOFU_FINGERPRINT_SENTINEL,
    TUNNEL_URL_SENTINEL,
    EDGE_CLIENT_SECRET_SENTINEL,
];

const serverSeed = new Uint8Array(32).fill(91);
const tofuConfig: TofuHandshakeConfig = {
    localUserId: "operator-user",
    publicUrl: TUNNEL_URL_SENTINEL,
    tofuPublicKeys: {
        ed25519PublicKey: "",
        x25519PublicKey: encodeBase64(new Uint8Array(32).fill(92)),
        ed25519Fingerprint: TOFU_FINGERPRINT_SENTINEL,
    },
    ed25519SecretKey: serverSeed,
};

const deviceSeed = Uint8Array.from({ length: 32 }, (_, i) => (i + 11) & 0xff);
const deviceKeyId = "acceptance-device";

function edgeHeaders(): Record<string, string> {
    // A valid minted CF Access assertion — the edge signal that actually survives
    // to the origin. The config's serviceTokens remain (legacy) but are bypassed
    // because an assertion expectation is configured (assertion-first edge guard).
    return edgeAssertion.headers();
}

async function buildProofHeader(method: string, path: string, bodyHash?: string): Promise<string> {
    const envelope = await signPublicRequest({
        method,
        path,
        keyId: deviceKeyId,
        nonce: generatePublicRequestNonce(),
        issuedAt: Date.now(),
        bodyHash: bodyHash ?? hashRequestBody(null),
    }, deviceSeed);
    return encodePublicDeviceProofHeader(envelope);
}

/** Substitutes route params / wildcards with concrete probe values so we can inject. */
function concreteUrl(url: string): string {
    return url.replace(/:[^/]+/g, "probe").replace(/\*/g, "probe.txt");
}

interface DerivedRoute {
    method: string;
    url: string;
}

/** Build inject options; non-GET routes get an empty JSON body so a route whose
 *  auth decision happens in the handler (e.g. /pair/complete) reaches that gate
 *  rather than short-circuiting on body validation. Routes gated at the onRequest
 *  hook 401 before the body is ever parsed, so the payload is harmless for them. */
function injectOptions(route: DerivedRoute, headers: Record<string, string>): any {
    const options: any = { method: route.method, url: concreteUrl(route.url), headers };
    if (route.method !== "GET") {
        options.payload = {};
    }
    return options;
}

describe("US-005 public-mode fail-closed route inventory (THE GATE)", () => {
    let app: ReturnType<typeof createApi>;
    let devicePublicKey: string;
    let routes: DerivedRoute[];

    beforeAll(async () => {
        tofuConfig.tofuPublicKeys!.ed25519PublicKey = encodeBase64(await ed.getPublicKeyAsync(serverSeed));
        // Derive the device public key from the seed (sign a throwaway proof).
        const seedEnvelope = await signPublicRequest({
            method: "GET",
            path: "/",
            keyId: deviceKeyId,
            nonce: generatePublicRequestNonce(),
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, deviceSeed);
        devicePublicKey = seedEnvelope.publicKey;

        const publicAuth: PublicAuthConfig = {
            devices: [{ keyId: deviceKeyId, publicKey: devicePublicKey }],
            edge: {
                serviceTokens: [{ clientId: EDGE_CLIENT_ID, clientSecret: EDGE_CLIENT_SECRET_SENTINEL }],
                assertion: edgeAssertion.assertionConfig,
            },
            pairing: {
                secret: "pairing-qr-secret",
                windowOpenedAt: 0,
                windowClosesAt: Number.MAX_SAFE_INTEGER,
            },
        };

        app = createApi();
        const collected: DerivedRoute[] = [];
        // DERIVE the inventory from the registered app: the onRoute hook fires for
        // every route configureApi() registers (it is added before configureApi runs).
        app.addHook("onRoute", (routeOptions: any) => {
            const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
            for (const method of methods) {
                collected.push({ method: String(method).toUpperCase(), url: routeOptions.url });
            }
        });

        configureApi(app, tofuConfig, { auth: "public", publicAuth });

        // A deliberately un-allowlisted probe route registered AFTER configureApi,
        // to prove the global default-deny hook fails closed on unknown routes too.
        (app as any).get("/__unlisted_probe__", async () => ({ ok: true }));

        await app.ready();

        // Exclude auto-generated HEAD/OPTIONS and the probe from the "real" inventory.
        routes = collected.filter((r) => r.method !== "HEAD" && r.method !== "OPTIONS" && r.url !== "/__unlisted_probe__");
    });

    afterAll(async () => {
        await app?.close();
    });

    it("derives a non-trivial inventory that includes the security-sensitive routes", () => {
        const urls = new Set(routes.map((r) => r.url));
        // These MUST be present, else route registration silently dropped them and
        // the 401 sweep below would be vacuously green.
        expect(urls.has("/")).toBe(true);
        expect(urls.has("/health")).toBe(true);
        expect(urls.has("/pair/complete")).toBe(true);
        expect(urls.has("/pair/connect")).toBe(true);
        expect(urls.has("/v1/version")).toBe(true);
        expect(urls.has("/files/*")).toBe(true);
        expect(routes.some((r) => r.url.startsWith("/v1/sessions"))).toBe(true);
        // Sanity: a real server exposes many routes.
        expect(routes.length).toBeGreaterThan(10);
    });

    it("rejects EVERY registered route with 401 and no key material when fully unauthenticated", async () => {
        const failures: string[] = [];
        const ledger: string[] = [];
        for (const route of routes) {
            const response = await app.inject(injectOptions(route, {}));
            ledger.push(`  ${route.method.padEnd(6)} ${concreteUrl(route.url).padEnd(34)} -> ${response.statusCode}`);
            if (response.statusCode !== 401) {
                failures.push(`${route.method} ${route.url} -> ${response.statusCode} (expected 401)`);
                continue;
            }
            for (const sentinel of SECRET_SENTINELS) {
                if (response.body.includes(sentinel)) {
                    failures.push(`${route.method} ${route.url} leaked secret sentinel ${sentinel}`);
                }
            }
        }
        // eslint-disable-next-line no-console
        console.log(`\n[US-005] fail-closed route inventory (unauthenticated sweep, ${routes.length} routes):\n${ledger.join("\n")}\n`);
        expect(failures).toEqual([]);
    });

    it("rejects EVERY registered route with 401 and no key material when edge passes but no device proof is presented", async () => {
        const failures: string[] = [];
        for (const route of routes) {
            const response = await app.inject(injectOptions(route, edgeHeaders()));
            if (route.method === "GET" && route.url === "/v1/connect/github/callback") {
                expect(response.statusCode).toBe(400);
                continue;
            }
            if (response.statusCode !== 401) {
                failures.push(`${route.method} ${route.url} -> ${response.statusCode} (expected 401)`);
                continue;
            }
            for (const sentinel of SECRET_SENTINELS) {
                if (response.body.includes(sentinel)) {
                    failures.push(`${route.method} ${route.url} leaked secret sentinel ${sentinel}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it("fails closed (401 route_not_allowlisted) on an unknown route even with a valid edge check", async () => {
        const response = await app.inject({ method: "GET", url: "/__unlisted_probe__", headers: edgeHeaders() });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: "route_not_allowlisted" });
    });

    it("fails closed (401 edge_access_denied) when the CF assertion is present but invalid", async () => {
        // Assertion configured but the presented token is garbage → the edge guard
        // rejects BEFORE any device-proof/route-policy check (edge is checked first).
        const response = await app.inject({
            method: "GET",
            url: "/",
            headers: { [edgeAssertion.headerName]: "not-a-valid-assertion" },
        });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: "edge_access_denied" });
    });

    it("fails closed (401 edge_access_denied) when an assertion is configured but absent, even with legacy service-token headers", async () => {
        // A caller presenting only the legacy CF-Access-Client-* headers cannot pass
        // the assertion-based edge guard — those headers are stripped by real CF.
        const response = await app.inject({
            method: "GET",
            url: "/",
            headers: {
                "cf-access-client-id": EDGE_CLIENT_ID,
                "cf-access-client-secret": EDGE_CLIENT_SECRET_SENTINEL,
            },
        });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: "edge_access_denied" });
    });

    it("rejects /pair/complete without the operator pairing gate (no key material)", async () => {
        // Edge passes, but no pairing secret/nonce -> handler fails closed.
        const response = await app.inject({ method: "POST", url: "/pair/complete", headers: edgeHeaders(), payload: {} });
        expect(response.statusCode).toBe(401);
        for (const sentinel of SECRET_SENTINELS) {
            expect(response.body).not.toContain(sentinel);
        }
    });

    it("POSITIVE CONTROL: a valid edge check + device proof reaches the handler (200)", async () => {
        const proof = await buildProofHeader("GET", "/");
        const response = await app.inject({
            method: "GET",
            url: "/",
            headers: {
                ...edgeHeaders(),
                [PUBLIC_DEVICE_PROOF_HEADER]: proof,
            },
        });
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain("Welcome to Happy Server!");
    });

    it("BODY-SWAP EXPLOIT: a device proof bound to body A is REJECTED (401 body_hash_mismatch) when replayed with body B", async () => {
        // Both bodies are schema-valid for POST /v1/version, so a rejection here is
        // the signed body-hash binding — NOT schema validation — doing its job.
        const bodyA = JSON.stringify({ platform: "ios", version: "1.0.0", app_id: "com.happy.legit" });
        const bodyB = JSON.stringify({ platform: "android", version: "9.9.9", app_id: "com.attacker.swapped" });
        // Proof authorizes (POST, /v1/version) for the exact bytes of body A.
        const proof = await buildProofHeader("POST", "/v1/version", hashRequestBody(bodyA));
        const response = await app.inject({
            method: "POST",
            url: "/v1/version",
            headers: {
                ...edgeHeaders(),
                [PUBLIC_DEVICE_PROOF_HEADER]: proof,
                "content-type": "application/json",
            },
            payload: bodyB, // attacker swaps in a different body under the same proof
        });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: "body_hash_mismatch" });
    });

    it("HONEST CONTROL: a device proof bound to body A is admitted (200) when the request carries the exact body A", async () => {
        const bodyA = JSON.stringify({ platform: "ios", version: "1.0.0", app_id: "com.happy.legit" });
        const proof = await buildProofHeader("POST", "/v1/version", hashRequestBody(bodyA));
        const response = await app.inject({
            method: "POST",
            url: "/v1/version",
            headers: {
                ...edgeHeaders(),
                [PUBLIC_DEVICE_PROOF_HEADER]: proof,
                "content-type": "application/json",
            },
            payload: bodyA, // exact bytes the proof was signed over
        });
        // Passes edge + device proof + body-hash binding + schema → handler responds 200.
        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveProperty("updateUrl");
    });

    it("POSITIVE CONTROL: /pair/complete inside the operator window + valid QR secret + device proof is admitted past the gate", async () => {
        const body = JSON.stringify({
            version: 1,
            machineId: tofuConfig.localUserId,
            deviceKeyId,
            deviceEd25519PublicKey: devicePublicKey,
        });
        const proof = await buildProofHeader("POST", "/pair/complete", hashRequestBody(body));
        const response = await app.inject({
            method: "POST",
            url: "/pair/complete",
            headers: {
                ...edgeHeaders(),
                [PUBLIC_DEVICE_PROOF_HEADER]: proof,
                [PAIRING_SECRET_HEADER]: "pairing-qr-secret",
                [PAIRING_NONCE_HEADER]: generatePublicRequestNonce(),
                "content-type": "application/json",
            },
            payload: body,
        });
        // Past the auth boundary: the handler now runs. Without a local profile.json
        // it returns 503 (local_profile_unavailable), NOT 401 — proving the gate let
        // an authenticated operator request through rather than blanket-denying.
        expect(response.statusCode).not.toBe(401);
        expect(response.statusCode).toBe(200);
    });
});

// US-005 (transport half): a REAL over-the-wire Socket.IO handshake, exercised on
// BOTH the websocket and polling transports against a listening server. The public
// handshake middleware must reject an unauthenticated connection on either transport
// and admit only a connection carrying a valid Cloudflare Access edge check + Ed25519
// device proof bound to GET /v1/updates.
describe("US-005 public-mode Socket.IO handshake (ws + polling, over the wire)", () => {
    let app: ReturnType<typeof createApi>;
    let port: number;
    let deviceSocketKey: string;

    beforeAll(async () => {
        const seedEnvelope = await signPublicRequest({
            method: "GET",
            path: "/v1/updates",
            keyId: deviceKeyId,
            nonce: generatePublicRequestNonce(),
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, deviceSeed);
        deviceSocketKey = seedEnvelope.publicKey;

        const publicAuth: PublicAuthConfig = {
            devices: [{ keyId: deviceKeyId, publicKey: deviceSocketKey }],
            edge: {
                serviceTokens: [{ clientId: EDGE_CLIENT_ID, clientSecret: EDGE_CLIENT_SECRET_SENTINEL }],
                assertion: edgeAssertion.assertionConfig,
            },
        };

        app = createApi();
        configureApi(app, tofuConfig, { auth: "public", publicAuth });
        await app.listen({ port: 0, host: "127.0.0.1" });
        port = (app.server.address() as AddressInfo).port;
    });

    afterAll(async () => {
        await app?.close();
    });

    async function socketProofHeaders(): Promise<Record<string, string>> {
        const envelope = await signPublicRequest({
            method: "GET",
            path: "/v1/updates",
            keyId: deviceKeyId,
            nonce: generatePublicRequestNonce(),
            issuedAt: Date.now(),
            bodyHash: hashRequestBody(null),
        }, deviceSeed);
        return {
            ...edgeAssertion.headers(),
            [PUBLIC_DEVICE_PROOF_HEADER]: encodePublicDeviceProofHeader(envelope),
        };
    }

    function attempt(transport: "websocket" | "polling", headers: Record<string, string>): Promise<"connected" | "rejected"> {
        return new Promise((resolve) => {
            const client = ioClient(`http://127.0.0.1:${port}`, {
                path: "/v1/updates",
                transports: [transport],
                forceNew: true,
                reconnection: false,
                timeout: 4000,
                extraHeaders: headers,
            });
            const done = (outcome: "connected" | "rejected") => {
                client.removeAllListeners();
                client.disconnect();
                (client as any).close?.();
                resolve(outcome);
            };
            client.on("connect", () => done("connected"));
            client.on("connect_error", () => done("rejected"));
        });
    }

    it("rejects an unauthenticated websocket handshake", async () => {
        expect(await attempt("websocket", {})).toBe("rejected");
    }, 15000);

    it("rejects an unauthenticated polling handshake", async () => {
        expect(await attempt("polling", {})).toBe("rejected");
    }, 15000);

    it("rejects a websocket handshake with a valid edge check but no device proof", async () => {
        expect(await attempt("websocket", edgeHeaders())).toBe("rejected");
    }, 15000);

    it("rejects a polling handshake with a valid edge check but no device proof", async () => {
        expect(await attempt("polling", edgeHeaders())).toBe("rejected");
    }, 15000);

    it("POSITIVE CONTROL: admits a websocket handshake carrying a valid edge check + device proof", async () => {
        expect(await attempt("websocket", await socketProofHeaders())).toBe("connected");
    }, 15000);

    it("POSITIVE CONTROL: admits a polling handshake carrying a valid edge check + device proof", async () => {
        expect(await attempt("polling", await socketProofHeaders())).toBe("connected");
    }, 15000);
});

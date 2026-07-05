import { afterEach, describe, expect, it } from "vitest";
import { configureApi, createApi } from "../api";

describe("CORS allowed methods and headers", () => {
    const originalOrigins = process.env.HAPPY_CORS_ORIGINS;
    const apps: ReturnType<typeof createApi>[] = [];

    afterEach(async () => {
        process.env.HAPPY_CORS_ORIGINS = originalOrigins;
        await Promise.all(apps.splice(0).map(app => app.close()));
    });

    it("allows PUT preflight for /v2/me/settings and lists X-Loopback-Capability", async () => {
        process.env.HAPPY_CORS_ORIGINS = "https://app.example.test";
        const app = createApi();
        apps.push(app);
        configureApi(app);

        const response = await app.inject({
            method: "OPTIONS",
            url: "/v2/me/settings",
            headers: {
                Origin: "https://app.example.test",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "X-Loopback-Capability",
            },
        });

        expect(response.statusCode).toBe(204);
        expect(response.headers["access-control-allow-methods"]).toContain("PUT");
        expect(response.headers["access-control-allow-headers"]).toContain("X-Loopback-Capability");
    });

    it("allows a /pair/complete preflight carrying the pairing secret + nonce headers", async () => {
        process.env.HAPPY_CORS_ORIGINS = "https://app.example.test";
        const app = createApi();
        apps.push(app);
        configureApi(app);

        const response = await app.inject({
            method: "OPTIONS",
            url: "/pair/complete",
            headers: {
                Origin: "https://app.example.test",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-happy-pairing-secret, x-happy-pairing-nonce",
            },
        });

        expect(response.statusCode).toBe(204);
        // @fastify/cors echoes the configured allowlist; assert case-insensitively so
        // the configured PascalCase entries satisfy the browser's lowercase request.
        const allowHeaders = String(response.headers["access-control-allow-headers"]).toLowerCase();
        expect(allowHeaders).toContain("x-happy-pairing-secret");
        expect(allowHeaders).toContain("x-happy-pairing-nonce");
        // The device-proof + CF-Access headers must remain in the allowlist.
        expect(allowHeaders).toContain("x-happy-device-proof");
        expect(allowHeaders).toContain("cf-access-client-id");
        expect(allowHeaders).toContain("cf-access-client-secret");
        // `Cf-Access-Jwt-Assertion` is CF-injected, never browser-sent: must NOT be present.
        expect(allowHeaders).not.toContain("cf-access-jwt-assertion");
    });
});


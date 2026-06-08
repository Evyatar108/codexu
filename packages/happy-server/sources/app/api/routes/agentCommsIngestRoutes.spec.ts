import { describe, expect, it, vi } from "vitest";
import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { agentCommsIngestRoutes } from "./agentCommsIngestRoutes";
import type { Fastify } from "../types";

function makeApp(handler?: ReturnType<typeof vi.fn> | null) {
    const app = fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate("authenticate", async function () {});
    typed.decorate("authenticateTunnel", async function () {});
    typed.decorate("verifyLoopbackCapability", async function () {});
    const configuredHandler = handler === undefined ? vi.fn(async () => ({ id: "mb-1", seq: 1 })) : handler;
    agentCommsIngestRoutes(typed, { handler: configuredHandler ?? undefined });
    return { app, handler: configuredHandler };
}

const validBody = {
    envelope: {
        v: 1,
        id: "env-1",
        ts: 1,
        from: { machineId: "machine-a", sessionId: "sender" },
        to: { machineId: "machine-b", sessionId: "target" },
        scope: "A",
        channel: "message",
        kind: "request",
        hopCount: 0,
        hopPath: ["machine-a:sender"],
        body: { nonce: "n", ciphertext: "c" },
    },
    signature: "sig",
    senderKeys: {
        ed25519PublicKey: "ed-pub",
        ecdhPublicKey: "ecdh-pub",
        ed25519Fingerprint: "SHA256:abc",
    },
};

describe("agentCommsIngestRoutes", () => {
    it("delegates valid signed/sealed envelope shapes to the injected handler", async () => {
        const { app, handler } = makeApp();

        const response = await app.inject({ method: "POST", url: "/agent-comms/ingest", payload: validBody });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ id: "mb-1", seq: 1 });
        expect(handler).toHaveBeenCalledWith(validBody);
        await app.close();
    });

    it("rejects hop loops before delegating", async () => {
        const { app, handler } = makeApp();

        const response = await app.inject({
            method: "POST",
            url: "/agent-comms/ingest",
            payload: {
                ...validBody,
                envelope: { ...validBody.envelope, hopPath: ["target"] },
            },
        });

        expect(response.statusCode).toBe(400);
        expect(handler).not.toHaveBeenCalled();
        await app.close();
    });

    it("fails closed when no daemon handler is configured", async () => {
        const { app } = makeApp(null);

        const response = await app.inject({ method: "POST", url: "/agent-comms/ingest", payload: validBody });

        expect(response.statusCode).toBe(503);
        await app.close();
    });
});

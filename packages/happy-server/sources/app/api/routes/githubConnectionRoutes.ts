import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";

import { buildUpdateAccountUpdate, type EventRouter } from "@/app/events/eventRouter";
import {
    GithubConnectionProfileSchema,
    writeGithubConnection,
} from "@/app/github/githubConnectionStore";
import { allocateUpdateSeq } from "@/storage/seq";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import type { Fastify } from "../types";

const OAUTH_STATE_TTL_MS = 5 * 60_000;
const states = new Map<string, number>();

export interface GithubConnectionRouteOptions {
    localUserId: string;
    githubConnectionPath?: string;
}

function githubConnectionPath(options: GithubConnectionRouteOptions): string {
    return options.githubConnectionPath
        ?? path.join(os.homedir(), ".happy", "github-connection.json");
}

function githubConfiguration(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
} | null {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = process.env.GITHUB_REDIRECT_URI;
    return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

async function emitProfileUpdate(
    eventRouter: EventRouter,
    localUserId: string,
    github: z.infer<typeof GithubConnectionProfileSchema> | null,
): Promise<void> {
    const seq = await allocateUpdateSeq();
    eventRouter.emitUpdate({
        payload: buildUpdateAccountUpdate(localUserId, { github }, seq, randomKeyNaked(12)),
        recipientFilter: { type: "user-scoped-only" },
    });
}

export function githubConnectionRoutes(
    app: Fastify,
    eventRouter: EventRouter,
    options: GithubConnectionRouteOptions,
) {
    app.get("/v1/connect/github/params", {
        preHandler: [app.authenticate],
        schema: {
            response: {
                200: z.object({ enabled: z.boolean(), url: z.string().url().optional() }),
            },
        },
    }, async () => {
        const config = githubConfiguration();
        if (!config) {
            return { enabled: false };
        }
        const state = randomBytes(32).toString("base64url");
        states.set(state, Date.now() + OAUTH_STATE_TTL_MS);
        const url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", config.clientId);
        url.searchParams.set("redirect_uri", config.redirectUri);
        url.searchParams.set("scope", "read:user user:email");
        url.searchParams.set("state", state);
        return { enabled: true, url: url.toString() };
    });

    app.get("/v1/connect/github/callback", {
        schema: {
            querystring: z.object({ code: z.string().min(1), state: z.string().min(1) }),
            response: {
                200: z.object({ connected: z.literal(true), login: z.string() }),
                400: z.object({ error: z.string() }),
                503: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        const config = githubConfiguration();
        if (!config) {
            return reply.code(503).send({ error: "github_connection_disabled" });
        }
        const expiry = states.get(request.query.state);
        states.delete(request.query.state);
        if (!expiry || expiry < Date.now()) {
            return reply.code(400).send({ error: "invalid_oauth_state" });
        }
        const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                redirect_uri: config.redirectUri,
                code: request.query.code,
            }),
        });
        const tokenPayload = await tokenResponse.json() as { access_token?: unknown };
        if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") {
            return reply.code(400).send({ error: "github_token_exchange_failed" });
        }
        const profileResponse = await fetch("https://api.github.com/user", {
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${tokenPayload.access_token}`,
            },
        });
        const rawProfile = await profileResponse.json();
        const profile = GithubConnectionProfileSchema.safeParse(rawProfile);
        if (!profileResponse.ok || !profile.success) {
            return reply.code(400).send({ error: "github_profile_fetch_failed" });
        }
        await writeGithubConnection(
            githubConnectionPath(options),
            options.localUserId,
            profile.data,
            tokenPayload.access_token,
        );
        await emitProfileUpdate(eventRouter, options.localUserId, profile.data);
        return { connected: true as const, login: profile.data.login };
    });

    app.delete("/v1/connect/github", {
        preHandler: [app.authenticate],
        schema: {
            response: {
                200: z.object({ disconnected: z.literal(true) }),
            },
        },
    }, async () => {
        await unlink(githubConnectionPath(options)).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        });
        await emitProfileUpdate(eventRouter, options.localUserId, null);
        return { disconnected: true as const };
    });
}

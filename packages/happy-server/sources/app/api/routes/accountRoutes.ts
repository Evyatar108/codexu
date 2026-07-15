import { z } from "zod";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { writeJsonAtomically } from "@slopus/happy-wire/node";
import { type Fastify } from "../types";
import { type ApiPaths } from "../api";
import { CanonicalLocalProfileSchema, type CanonicalLocalProfile } from "@slopus/happy-wire";
import { readGithubConnection } from "@/app/github/githubConnectionStore";

const SettingsSchema = z.record(z.unknown());

export interface AccountRoutesOptions {
    paths?: ApiPaths;
    localUserId: string;
}

function defaultProfilePath(): string {
    return path.join(os.homedir(), ".happy", "local-profile.json");
}

function defaultAccountSettingsPath(): string {
    return path.join(os.homedir(), ".happy", "account-settings.json");
}

async function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
        return schema.parse(JSON.parse(await fs.readFile(filePath, "utf-8")));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

export function accountRoutes(app: Fastify, options: AccountRoutesOptions) {
    const profilePath = options.paths?.profile ?? defaultProfilePath();
    const accountSettingsPath = options.paths?.accountSettings ?? defaultAccountSettingsPath();
    const githubConnectionPath = options.paths?.githubConnection
        ?? path.join(path.dirname(profilePath), "github-connection.json");

    app.get('/v2/me/profile', {
        preHandler: [app.authenticate],
        schema: {
            response: {
                200: CanonicalLocalProfileSchema,
                401: z.object({ error: z.string() }),
            },
        },
    }, async (_request, reply) => {
        const profile = await readJsonFile(profilePath, CanonicalLocalProfileSchema)
            ?? {
                id: options.localUserId,
                timestamp: Date.now(),
                firstName: null,
                lastName: null,
                avatar: null,
                github: null,
                connectedServices: [],
            } satisfies CanonicalLocalProfile;
        const github = await readGithubConnection(githubConnectionPath);
        return reply.send({
            ...profile,
            github: github ? {
                id: github.profile.id,
                login: github.profile.login,
                name: github.profile.name ?? "",
                avatar_url: github.profile.avatar_url,
                ...(github.profile.email ? { email: github.profile.email } : {}),
                bio: github.profile.bio,
            } : null,
            connectedServices: github ? ["github"] : [],
        });
    });

    app.get('/v2/me/settings', {
        preHandler: [app.authenticate],
        schema: {
            response: {
                200: SettingsSchema,
                401: z.object({ error: z.string() }),
            },
        },
    }, async (_request, reply) => {
        return reply.send(await readJsonFile(accountSettingsPath, SettingsSchema) ?? {});
    });

    app.put('/v2/me/settings', {
        preHandler: [app.authenticate],
        bodyLimit: 1024 * 1024,
        schema: {
            body: SettingsSchema,
            response: {
                200: SettingsSchema,
                401: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        await writeJsonAtomically(accountSettingsPath, request.body);
        return reply.send(request.body);
    });
}

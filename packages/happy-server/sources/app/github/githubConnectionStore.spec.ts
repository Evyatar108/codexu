import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { initEncrypt } from "@/modules/encrypt";
import { readGithubConnection, writeGithubConnection } from "./githubConnectionStore";

const roots: string[] = [];

describe("single-user GitHub connection store", () => {
    afterEach(async () => {
        await Promise.all(roots.splice(0).map(root => rm(root, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 50,
        })));
    });

    it("encrypts OAuth tokens and round-trips profile data", async () => {
        process.env.HANDY_MASTER_SECRET = "github-store-test-secret";
        await initEncrypt();
        const root = join(process.cwd(), `.github-connection-test-${randomUUID()}`);
        roots.push(root);
        await mkdir(root, { recursive: true });
        const file = join(root, "github-connection.json");
        const profile = {
            id: 42,
            login: "octocat",
            type: "User",
            site_admin: false,
            name: "The Octocat",
            avatar_url: "https://example.test/octocat.png",
            gravatar_id: null,
            company: null,
            blog: "",
            location: null,
            email: null,
            hireable: null,
            bio: null,
            twitter_username: null,
            public_repos: 1,
            public_gists: 0,
            followers: 0,
            following: 0,
            created_at: "2020-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
        };

        await writeGithubConnection(file, "local-user", profile, "gho_secret_value");

        const raw = await readFile(file, "utf8");
        expect(raw).not.toContain("gho_secret_value");
        await expect(readGithubConnection(file)).resolves.toEqual({
            profile,
            token: "gho_secret_value",
        });
    });
});

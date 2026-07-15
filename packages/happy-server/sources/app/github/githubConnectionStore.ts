import { decryptString, encryptString } from "@/modules/encrypt";
import { writeJsonAtomically } from "@slopus/happy-wire/node";
import { decodeBase64, encodeBase64 } from "privacy-kit";
import { readFile } from "node:fs/promises";
import { chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

export const GithubConnectionProfileSchema = z.object({
    id: z.number(),
    login: z.string(),
    type: z.string(),
    site_admin: z.boolean(),
    avatar_url: z.string(),
    gravatar_id: z.string().nullable(),
    name: z.string().nullable(),
    company: z.string().nullable(),
    blog: z.string(),
    location: z.string().nullable(),
    email: z.string().nullable(),
    hireable: z.boolean().nullable(),
    bio: z.string().nullable(),
    twitter_username: z.string().nullable(),
    public_repos: z.number(),
    public_gists: z.number(),
    followers: z.number(),
    following: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
}).passthrough();

const GithubConnectionFileSchema = z.object({
    version: z.literal(1),
    localUserId: z.string(),
    profile: GithubConnectionProfileSchema,
    encryptedToken: z.string(),
    connectedAt: z.number().int().nonnegative(),
}).strict();

export type GithubConnectionProfile = z.infer<typeof GithubConnectionProfileSchema>;

export async function readGithubConnection(filePath: string): Promise<{
    profile: GithubConnectionProfile;
    token: string;
} | null> {
    try {
        const parsed = GithubConnectionFileSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
        return {
            profile: parsed.profile,
            token: decryptString(["github-connection", parsed.localUserId], decodeBase64(parsed.encryptedToken)),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

export async function writeGithubConnection(
    filePath: string,
    localUserId: string,
    profile: GithubConnectionProfile,
    token: string,
): Promise<void> {
    await writeJsonAtomically(filePath, {
        version: 1,
        localUserId,
        profile,
        encryptedToken: encodeBase64(encryptString(["github-connection", localUserId], token)),
        connectedAt: Date.now(),
    });
    if (process.platform === "win32" && process.env.USERNAME) {
        await promisify(execFile)(
            "icacls",
            [filePath, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:F`],
            { windowsHide: true },
        );
    } else {
        await chmod(filePath, 0o600);
    }
}

import type { PGlite } from "@electric-sql/pglite";
import * as fs from "fs";
import { createRequire } from "node:module";
import * as path from "path";

function resolveMigrationsDir(): string {
    const requireFromEntrypoint = createRequire(path.resolve(process.argv[1] ?? process.execPath));
    let packageEntryDir: string | null = null;
    try {
        packageEntryDir = path.dirname(requireFromEntrypoint.resolve("happy-server"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
            throw error;
        }
    }
    const candidates = [
        ...(packageEntryDir ? [path.resolve(packageEntryDir, "../prisma/migrations")] : []),
        path.join(process.cwd(), "prisma", "migrations"),
        path.join(process.cwd(), "packages", "happy-server", "prisma", "migrations"),
        path.join(path.dirname(process.execPath), "prisma", "migrations"),
    ];
    const migrationsDir = candidates.find(candidate => fs.existsSync(candidate));
    if (!migrationsDir) {
        throw new Error(`Could not find prisma/migrations directory; checked: ${candidates.join(", ")}`);
    }
    return migrationsDir;
}

/**
 * Applies every pending Prisma SQL migration to an embedded PGlite database.
 */
export async function applyPGliteMigrations(pg: PGlite): Promise<number> {
    await pg.exec(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
            "id" TEXT PRIMARY KEY,
            "migration_name" TEXT NOT NULL UNIQUE,
            "finished_at" TIMESTAMPTZ,
            "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
            "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
            "logs" TEXT
        );
    `);

    const migrationsDir = resolveMigrationsDir();
    const migrationNames = fs.readdirSync(migrationsDir)
        .filter(name => fs.statSync(path.join(migrationsDir, name)).isDirectory())
        .sort();
    const applied = await pg.query<{ migration_name: string }>(
        `SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`,
    );
    const appliedNames = new Set(applied.rows.map(row => row.migration_name));
    let appliedCount = 0;

    for (const migrationName of migrationNames) {
        if (appliedNames.has(migrationName)) {
            continue;
        }
        const sqlFile = path.join(migrationsDir, migrationName, "migration.sql");
        if (!fs.existsSync(sqlFile)) {
            continue;
        }

        await pg.exec(fs.readFileSync(sqlFile, "utf8"));
        await pg.query(
            `INSERT INTO "_prisma_migrations" ("id", "migration_name", "finished_at", "applied_steps_count") VALUES ($1, $2, now(), 1)`,
            [crypto.randomUUID(), migrationName],
        );
        appliedCount++;
    }

    return appliedCount;
}

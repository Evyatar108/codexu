import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { createPGlite } from "@/storage/pgliteLoader";

import { applyPGliteMigrations } from "@/storage/applyPGliteMigrations";

describe("applyPGliteMigrations", () => {
    const cleanupPaths: string[] = [];

    afterEach(async () => {
        await Promise.all(cleanupPaths.splice(0).map(cleanupPath =>
            rm(cleanupPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
        ));
    });

    it("rolls back schema changes when the migration ledger insert fails", async () => {
        const root = await mkdtemp(path.join(process.cwd(), ".test-pglite-migration-"));
        cleanupPaths.push(root);
        const migrationsDir = path.join(root, "migrations");
        const migrationDir = path.join(migrationsDir, "001_atomic");
        await mkdir(migrationDir, { recursive: true });
        const pg = createPGlite(path.join(root, "pglite"));
        await applyPGliteMigrations(pg, { migrationsDir });
        await pg.exec(`
            CREATE FUNCTION reject_migration_ledger_insert() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'forced ledger failure';
            END;
            $$;
            CREATE TRIGGER reject_migration_ledger_insert
                BEFORE INSERT ON "_prisma_migrations"
                FOR EACH ROW EXECUTE FUNCTION reject_migration_ledger_insert();
        `);
        await writeFile(
            path.join(migrationDir, "migration.sql"),
            `CREATE TABLE "AtomicProbe" ("id" TEXT PRIMARY KEY);`,
            "utf8",
        );

        await expect(applyPGliteMigrations(pg, { migrationsDir })).rejects.toThrow("forced ledger failure");

        const table = await pg.query<{ relation: string | null }>(
            `SELECT to_regclass('"AtomicProbe"')::text AS relation`,
        );
        const ledger = await pg.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM "_prisma_migrations" WHERE "migration_name" = '001_atomic'`,
        );
        expect(table.rows[0]?.relation).toBeNull();
        expect(ledger.rows[0]?.count).toBe("0");

        await pg.exec(`
            DROP TRIGGER reject_migration_ledger_insert ON "_prisma_migrations";
            DROP FUNCTION reject_migration_ledger_insert();
        `);
        await expect(applyPGliteMigrations(pg, { migrationsDir })).resolves.toBe(1);
        const retriedTable = await pg.query<{ relation: string | null }>(
            `SELECT to_regclass('"AtomicProbe"')::text AS relation`,
        );
        const retriedLedger = await pg.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM "_prisma_migrations" WHERE "migration_name" = '001_atomic'`,
        );
        expect(retriedTable.rows[0]?.relation).toBe('"AtomicProbe"');
        expect(retriedLedger.rows[0]?.count).toBe("1");
        await pg.close();
    });

    it("applies and records a migration with an explicit transaction wrapper exactly once", async () => {
        const root = await mkdtemp(path.join(process.cwd(), ".test-pglite-migration-"));
        cleanupPaths.push(root);
        const migrationsDir = path.join(root, "migrations");
        const migrationDir = path.join(migrationsDir, "001_wrapped");
        await mkdir(migrationDir, { recursive: true });
        await writeFile(path.join(migrationDir, "migration.sql"), `
            -- Prisma may emit an explicit transaction for enum rewrites.
            BEGIN;
            CREATE TABLE "WrappedProbe" ("id" TEXT PRIMARY KEY);
            COMMIT;
        `, "utf8");
        const pg = createPGlite(path.join(root, "pglite"));

        await expect(applyPGliteMigrations(pg, { migrationsDir })).resolves.toBe(1);
        await expect(applyPGliteMigrations(pg, { migrationsDir })).resolves.toBe(0);

        const table = await pg.query<{ relation: string | null }>(
            `SELECT to_regclass('"WrappedProbe"')::text AS relation`,
        );
        const ledger = await pg.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM "_prisma_migrations" WHERE "migration_name" = '001_wrapped'`,
        );
        expect(table.rows[0]?.relation).toBe('"WrappedProbe"');
        expect(ledger.rows[0]?.count).toBe("1");
        await pg.close();
    });
});

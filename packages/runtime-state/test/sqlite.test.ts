import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  applySqliteRuntimeMigrations,
  DEFAULT_SQLITE_TIMEOUT_MS,
  openSqliteRuntimeDatabase,
  readSqliteRuntimeUserVersion,
  tableExists,
  withImmediateTransaction,
  writeSqliteRuntimeUserVersion,
} from "../src/node/index.ts";

const tempRoots: string[] = [];

describe("runtime-state sqlite", () => {
  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("opens a Node sqlite database directly and creates parent directories", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "runtime-state-sqlite-"));
    tempRoots.push(tempRoot);
    const databasePath = path.join(tempRoot, "nested", "state.sqlite");

    const database = openSqliteRuntimeDatabase(databasePath, {
      foreignKeys: false,
      timeoutMs: DEFAULT_SQLITE_TIMEOUT_MS,
    });

    try {
      expect(existsSync(path.dirname(databasePath))).toBe(true);

      database.exec("CREATE TABLE entries (value TEXT);");

      expect(tableExists(database, "entries")).toBe(true);
      expect(tableExists(database, "missing_entries")).toBe(false);
    } finally {
      database.close();
    }
  });

  it("commits and rolls back immediate transactions", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "runtime-state-sqlite-"));
    tempRoots.push(tempRoot);
    const database = openSqliteRuntimeDatabase(path.join(tempRoot, "state.sqlite"), {
      foreignKeys: false,
    });

    try {
      database.exec("CREATE TABLE entries (value TEXT);");

      withImmediateTransaction(database, () => {
        database.prepare("INSERT INTO entries (value) VALUES (?)").run("committed");
      });

      expect(
        database.prepare("SELECT value FROM entries ORDER BY rowid").all() as Array<{ value: string }>,
      ).toEqual([{ value: "committed" }]);

      expect(() =>
        withImmediateTransaction(database, () => {
          database.prepare("INSERT INTO entries (value) VALUES (?)").run("rolled-back");
          throw new Error("rollback");
        }),
      ).toThrow("rollback");

      expect(
        database.prepare("SELECT value FROM entries ORDER BY rowid").all() as Array<{ value: string }>,
      ).toEqual([{ value: "committed" }]);
    } finally {
      database.close();
    }
  });

  it("applies pragma configuration and supports read-only reopen", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "runtime-state-sqlite-"));
    tempRoots.push(tempRoot);
    const databasePath = path.join(tempRoot, "state.sqlite");
    const writableDatabase = openSqliteRuntimeDatabase(databasePath, {
      journalMode: "DELETE",
      synchronous: "FULL",
    });

    try {
      expect(
        writableDatabase.prepare("PRAGMA foreign_keys;").get() as { foreign_keys: number },
      ).toEqual({ foreign_keys: 1 });
      expect(
        writableDatabase.prepare("PRAGMA journal_mode;").get() as { journal_mode: string },
      ).toEqual({ journal_mode: "delete" });
      expect(
        writableDatabase.prepare("PRAGMA synchronous;").get() as { synchronous: number },
      ).toEqual({ synchronous: 2 });

      writableDatabase.exec("CREATE TABLE entries (value TEXT);");
    } finally {
      writableDatabase.close();
    }

    const readOnlyDatabase = openSqliteRuntimeDatabase(databasePath, {
      readOnly: true,
    });

    try {
      expect(tableExists(readOnlyDatabase, "entries")).toBe(true);
      expect(tableExists(readOnlyDatabase, "missing_entries")).toBe(false);
      expect(() => readOnlyDatabase.exec("CREATE TABLE blocked (value TEXT);")).toThrow();
    } finally {
      readOnlyDatabase.close();
    }
  });

  it("reads, validates, and writes sqlite user_version", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "runtime-state-sqlite-"));
    tempRoots.push(tempRoot);
    const database = openSqliteRuntimeDatabase(path.join(tempRoot, "state.sqlite"));

    try {
      expect(readSqliteRuntimeUserVersion(database)).toBe(0);

      writeSqliteRuntimeUserVersion(database, 3);
      expect(readSqliteRuntimeUserVersion(database)).toBe(3);

      expect(() => writeSqliteRuntimeUserVersion(database, -1)).toThrow(
        "SQLite runtime user_version must be a non-negative integer.",
      );
      expect(() => writeSqliteRuntimeUserVersion(database, 1.5)).toThrow(
        "SQLite runtime user_version must be a non-negative integer.",
      );
    } finally {
      database.close();
    }
  });

  it("applies sqlite runtime migrations in order and does not rerun completed versions", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "runtime-state-sqlite-"));
    tempRoots.push(tempRoot);
    const database = openSqliteRuntimeDatabase(path.join(tempRoot, "state.sqlite"));

    try {
      const appliedVersion = applySqliteRuntimeMigrations(database, {
        storeName: "runtime-state test store",
        schemaVersion: 2,
        migrations: [
          {
            version: 1,
            migrate(migrationDatabase) {
              migrationDatabase.exec("CREATE TABLE entries (value TEXT);");
            },
          },
          {
            version: 2,
            migrate(migrationDatabase) {
              migrationDatabase.exec("ALTER TABLE entries ADD COLUMN note TEXT DEFAULT '';");
            },
          },
        ],
      });

      expect(appliedVersion).toBe(2);
      expect(readSqliteRuntimeUserVersion(database)).toBe(2);
      expect(
        database
          .prepare("SELECT name FROM pragma_table_info('entries') ORDER BY cid")
          .all() as Array<{ name: string }>,
      ).toEqual([{ name: "value" }, { name: "note" }]);

      expect(
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 2,
          migrations: [
            {
              version: 1,
              migrate() {
                throw new Error("migration 1 should not rerun");
              },
            },
            {
              version: 2,
              migrate() {
                throw new Error("migration 2 should not rerun");
              },
            },
          ],
        }),
      ).toBe(2);
    } finally {
      database.close();
    }
  });

  it("rolls back failed migrations and rejects invalid migration plans", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "runtime-state-sqlite-"));
    tempRoots.push(tempRoot);
    const database = openSqliteRuntimeDatabase(path.join(tempRoot, "state.sqlite"));

    try {
      expect(() =>
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 1,
          migrations: [
            {
              version: 1,
              migrate(migrationDatabase) {
                migrationDatabase.exec("CREATE TABLE entries (value TEXT);");
                throw new Error("boom");
              },
            },
          ],
        }),
      ).toThrow("boom");
      expect(readSqliteRuntimeUserVersion(database)).toBe(0);
      expect(tableExists(database, "entries")).toBe(false);

      writeSqliteRuntimeUserVersion(database, 3);
      expect(readSqliteRuntimeUserVersion(database)).toBe(3);
      expect(() =>
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 2,
          migrations: [],
        }),
      ).toThrow("runtime-state test store requires migrations covering schema version 2, but none were provided.");

      expect(() =>
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 0,
          migrations: [
            {
              version: 1,
              migrate() {},
            },
          ],
        }),
      ).toThrow("runtime-state test store schemaVersion 0 cannot declare migrations.");

      expect(() =>
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 1,
          migrations: [
            {
              version: 1,
              migrate() {},
            },
          ],
        }),
      ).toThrow("runtime-state test store database schema version 3 is newer than supported version 1.");

      writeSqliteRuntimeUserVersion(database, 0);
      expect(readSqliteRuntimeUserVersion(database)).toBe(0);
      expect(() =>
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: -1,
          migrations: [],
        }),
      ).toThrow("runtime-state test store schemaVersion must be a non-negative integer. Received -1.");

      expect(readSqliteRuntimeUserVersion(database)).toBe(0);
      expect(() =>
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 2,
          migrations: [
            {
              version: 1,
              migrate() {},
            },
          ],
        }),
      ).toThrow("runtime-state test store migrations stop at version 1; expected 2.");

      writeSqliteRuntimeUserVersion(database, 0);
      expect(readSqliteRuntimeUserVersion(database)).toBe(0);
      expect(() =>
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 1,
          migrations: [
            {
              version: 1,
              migrate() {},
            },
            {
              version: 1,
              migrate() {},
            },
            {
              version: 2,
              migrate() {},
            },
          ],
        }),
      ).toThrow(
        "runtime-state test store migrations must be strictly increasing. Duplicate or out-of-order version 1.",
      );

      expect(readSqliteRuntimeUserVersion(database)).toBe(0);
      expect(
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 0,
          migrations: [],
        }),
      ).toBe(0);

      expect(readSqliteRuntimeUserVersion(database)).toBe(0);
      expect(() =>
        applySqliteRuntimeMigrations(database, {
          storeName: "runtime-state test store",
          schemaVersion: 2,
          migrations: [
            {
              version: 1.5,
              migrate() {},
            },
            {
              version: 2,
              migrate() {},
            },
          ],
        }),
      ).toThrow("runtime-state test store migration version must be a non-negative integer. Received 1.5.");
    } finally {
      database.close();
    }
  });
});

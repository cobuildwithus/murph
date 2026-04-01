import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SQLITE_TIMEOUT_MS,
  openSqliteRuntimeDatabase,
  tableExists,
  withImmediateTransaction,
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
});

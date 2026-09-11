import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseProofClientConfig, provePreviewDatabaseIsolation, readProofReference } from "../scripts/preview-database-proof";

const now = 1_800_000_000_000;
const production = "a".repeat(64);
const preview = "b".repeat(64);
const reference = { salt: "c".repeat(64), fingerprint: production, expiresAt: now + 60_000 };
const environment = {
  VERCEL: "1", VERCEL_ENV: "preview",
  DATABASE_URL: "postgresql://test:synthetic@runtime.example.test/test",
  DIRECT_DATABASE_URL: "postgresql://test:synthetic@direct.example.test/test",
  MURPH_DATABASE_PROOF_REFERENCE: JSON.stringify(reference),
};

describe("Preview database separation proof", () => {
  it("requires both Preview endpoints to agree and differ from production", async () => {
    const read = vi.fn().mockResolvedValue(preview);
    expect(await provePreviewDatabaseIsolation(environment, read, () => now)).toBe("different database");
    expect(read.mock.calls).toEqual([
      [environment.DATABASE_URL, reference.salt], [environment.DIRECT_DATABASE_URL, reference.salt],
    ]);
  });

  it.each([
    [production, production], // Same identity can also be a physical clone.
    [preview, production], // Runtime/migration endpoint mismatch.
    [preview, "d".repeat(64)],
  ])("does not qualify ambiguous endpoint identities", async (runtime, direct) => {
    const read = vi.fn().mockResolvedValueOnce(runtime).mockResolvedValueOnce(direct);
    expect(await provePreviewDatabaseIsolation(environment, read, () => now)).toBe("unable to verify");
  });

  it.each([
    { VERCEL: "0" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
    { DATABASE_URL: "" }, { DIRECT_DATABASE_URL: "" }, { MURPH_DATABASE_PROOF_REFERENCE: "{}" },
  ])("never connects for an ineligible execution environment", async (override) => {
    const read = vi.fn();
    expect(await provePreviewDatabaseIsolation({ ...environment, ...override }, read, () => now)).toBe("unable to verify");
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects evidence that expires during the queries", async () => {
    const clock = vi.fn().mockReturnValueOnce(now).mockReturnValue(reference.expiresAt);
    expect(await provePreviewDatabaseIsolation(environment, async () => preview, clock)).toBe("unable to verify");
  });

  it("discards provider errors without exposing their message", async () => {
    const read = vi.fn().mockRejectedValue(new Error(environment.DATABASE_URL));
    expect(await provePreviewDatabaseIsolation(environment, read, () => now)).toBe("unable to verify");
  });

  it.each(["", "null", "[]", "not-json", JSON.stringify({ ...reference, expiresAt: now }),
    JSON.stringify({ ...reference, expiresAt: now + 16 * 60_000 }),
    JSON.stringify({ ...reference, fingerprint: "unverified" })])("rejects invalid reference input", (value) => {
    expect(readProofReference(value, now)).toBeNull();
  });

  it("prevents connection URL options from weakening TLS or read-only bounds", () => {
    const config = databaseProofClientConfig(`${environment.DATABASE_URL}?sslmode=disable&connection_limit=99`);
    expect(config.connectionString).toBe(environment.DATABASE_URL);
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.options).toContain("default_transaction_read_only=on");
    expect(config.options).toContain("statement_timeout=3000");
    expect(config.connectionTimeoutMillis).toBe(4_000);
  });

  it.each(["host=other.example.test", "user=another-role", "options=project%3Dother", "password=other", "port=5433"])(
    "rejects target overrides instead of probing a modified destination: %s", (query) => {
      expect(() => databaseProofClientConfig(`${environment.DATABASE_URL}?${query}`)).toThrow();
    },
  );

  it("rejects endpoints that could inherit connection identity from ambient PG variables", () => {
    expect(() => databaseProofClientConfig("postgresql://runtime.example.test/test")).toThrow();
    expect(() => databaseProofClientConfig("postgresql://test@runtime.example.test/test")).toThrow();
  });

  it("publishes only a coarse static result and refuses to reuse existing output", () => {
    const cwd = mkdtempSync(join(tmpdir(), "murph-db-proof-"));
    try {
      const script = fileURLToPath(new URL("../scripts/preview-database-proof.ts", import.meta.url));
      const run = () => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "--vercel-build"], {
        cwd, encoding: "utf8", env: { VERCEL: "1", VERCEL_ENV: "preview" }, timeout: 10_000,
      });
      const result = run();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("unable to verify\n");
      expect(result.stderr).toBe("");
      expect(readdirSync(join(cwd, ".vercel/output/static"))).toEqual(["result.txt"]);
      expect(readFileSync(join(cwd, ".vercel/output/static/result.txt"), "utf8")).toBe(result.stdout);
      expect(run().status).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  it("cannot produce a production deployment artifact", () => {
    const cwd = mkdtempSync(join(tmpdir(), "murph-db-proof-"));
    try {
      const script = fileURLToPath(new URL("../scripts/preview-database-proof.ts", import.meta.url));
      const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "--vercel-build"], {
        cwd, encoding: "utf8", env: { VERCEL: "1", VERCEL_ENV: "production" }, timeout: 10_000,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("unable to verify\n");
      expect(readdirSync(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

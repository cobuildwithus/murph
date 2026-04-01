import { describe, expect, it } from "vitest";

import { normalizePrismaConnectionString } from "@/src/lib/prisma";

describe("normalizePrismaConnectionString", () => {
  it("removes libpq-style system certificate sentinels that the pg adapter treats as file paths", () => {
    const normalized = normalizePrismaConnectionString(
      "postgresql://user:pass@example.com/db?sslmode=require&sslrootcert=system",
    );
    const url = new URL(normalized);

    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.has("sslrootcert")).toBe(false);
  });

  it("leaves ordinary Postgres URLs unchanged", () => {
    const databaseUrl = "postgresql://user:pass@example.com/db?sslmode=require";

    expect(normalizePrismaConnectionString(databaseUrl)).toBe(databaseUrl);
  });
});

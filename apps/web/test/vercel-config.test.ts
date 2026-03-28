import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("apps/web vercel config", () => {
  it("schedules the hosted execution outbox cron route", () => {
    const configPath = path.resolve(process.cwd(), "apps/web/vercel.json");
    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };

    expect(config.crons).toContainEqual({
      path: "/api/internal/hosted-execution/outbox/cron",
      schedule: "*/1 * * * *",
    });
  });

  it("schedules the hosted AI usage cron route", () => {
    const configPath = path.resolve(process.cwd(), "apps/web/vercel.json");
    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };

    expect(config.crons).toContainEqual({
      path: "/api/internal/hosted-execution/usage/cron",
      schedule: "*/5 * * * *",
    });
  });
});

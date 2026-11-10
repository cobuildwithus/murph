import process from "node:process";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("prisma/config", () => ({ defineConfig: (config: unknown) => config }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(["1", "0"])("Prisma dotenv opt-out is explicit (%s)", async (skip) => {
  vi.stubEnv("MURPH_PRISMA_SKIP_ENV_FILES", skip);
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/murph_test_config");
  const load = vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
  const { default: config } = await import("../prisma.config.ts");
  expect(load).toHaveBeenCalledTimes(skip === "1" ? 0 : 2);
  expect(config.datasource?.url).toBe(process.env.DATABASE_URL);
});

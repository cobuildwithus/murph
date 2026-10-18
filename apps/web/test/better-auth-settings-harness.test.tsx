import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: vi.fn(), notFound: vi.fn((): never => { throw new Error("not found"); }) }));
vi.mock("next/headers", () => ({ headers: request.headers }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  notFound: request.notFound,
}));
import BetterAuthSettingsHarness from "../app/test/better-auth-settings/page";

beforeEach(() => {
  request.notFound.mockClear();
  request.headers.mockResolvedValue(new Headers({ host: "localhost:3210" }));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_DIST_DIR_MODE", "smoke");
});
afterEach(() => { vi.unstubAllEnvs(); });

test.each([
  { name: "production, even with smoke mode and a loopback Host", nodeEnv: "production", mode: "smoke", host: "localhost:3210" },
  { name: "ordinary development", nodeEnv: "development", mode: "", host: "localhost:3210" },
  { name: "non-loopback smoke requests", nodeEnv: "development", mode: "smoke", host: "example.test" },
  { name: "missing Host", nodeEnv: "development", mode: "smoke", host: "" },
])("settings controller fixture returns not found for $name", async ({ nodeEnv, mode, host }) => {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("NEXT_DIST_DIR_MODE", mode);
  request.headers.mockResolvedValue(new Headers({ host, "x-forwarded-host": "localhost:3210" }));
  await expect(BetterAuthSettingsHarness({ searchParams: Promise.resolve({}) })).rejects.toThrow("not found");
  expect(request.notFound).toHaveBeenCalledOnce();
});

test.each(["localhost:3210", "127.0.0.1:3210", "[::1]:3210"])("loopback smoke fixture renders real settings presentation at %s", async (host) => {
  request.headers.mockResolvedValue(new Headers({ host }));
  for (const email of ["none", "connected"]) {
    const content = renderToStaticMarkup(await BetterAuthSettingsHarness({ searchParams: Promise.resolve({ email }) }));
    expect(content).toContain('aria-label="Connected accounts"');
    expect(content).toContain(email === "none" ? 'aria-label="Add Email"' : 'aria-label="Change Email"');
    expect(content).toContain('aria-label="Security"');
    expect(content).toContain("Recovery key");
  }
  expect(request.notFound).not.toHaveBeenCalled();
});

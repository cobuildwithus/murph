import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET } from "../app/api/device-sync/companion/app-policy/route";

afterEach(() => vi.unstubAllEnvs());

test.each([undefined, "", " "])("no minimum configured leaves updates optional (%s)", async (value) => {
  vi.stubEnv("HOSTED_IOS_MINIMUM_BUILD", value);
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ schemaVersion: 1, minimumIOSBuild: null });
});

test.each(["38", " 39 ", "2147483647"])("publishes only the explicit compatibility floor (%s)", async (value) => {
  vi.stubEnv("HOSTED_IOS_MINIMUM_BUILD", value);
  expect(await GET().json()).toEqual({ schemaVersion: 1, minimumIOSBuild: Number(value) });
});

test.each(["0", "-1", "1.2", "1e2", "01", "2147483648", "not-a-build"])("bad configuration cannot clear a known requirement (%s)", async (value) => {
  vi.stubEnv("HOSTED_IOS_MINIMUM_BUILD", value);
  const response = GET();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "APP_POLICY_UNAVAILABLE" });
});

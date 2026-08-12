import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  buildHostedLocalBrowserSessionCookie,
  clearHostedLocalBrowserEnvironment,
  formatHostedLocalBrowserResult,
  readHostedLocalBrowserEnvironmentValue,
  readHostedLocalBrowserTimeout,
} from "../scripts/hosted-local-browser-process.ts";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const RUNNER_NAME = "Hosted browser test";

describe("hosted-local browser process contracts", () => {
  it("builds the hosted session cookie from the subprocess contract", () => {
    expect(buildHostedLocalBrowserSessionCookie({
      sessionCookie: "murph_session=opaque%2Evalue; Path=/; HttpOnly",
      webBaseUrl: "http://localhost:3000",
    })).toEqual({
      httpOnly: true,
      name: "murph_session",
      sameSite: "Lax",
      secure: false,
      url: "http://localhost:3000/",
      value: "opaque.value",
    });
  });

  it("preserves __Host cookie requirements on a loopback browser origin", () => {
    expect(buildHostedLocalBrowserSessionCookie({
      sessionCookie: "__Host-murph_session=opaque",
      webBaseUrl: "http://127.0.0.1:3010",
    })).toMatchObject({
      name: "__Host-murph_session",
      secure: true,
      url: "https://127.0.0.1:3010/",
      value: "opaque",
    });
    expect(() => buildHostedLocalBrowserSessionCookie({
      sessionCookie: "malformed",
      webBaseUrl: "http://localhost:3000",
    })).toThrow("Hosted-local browser session cookie was malformed.");
  });

  it("reads required values and clears only the declared environment keys", () => {
    const environment: NodeJS.ProcessEnv = {
      KEEP: "kept",
      NODE_ENV: "test",
      SECRET: "secret",
      VALUE: "  configured  ",
    };

    expect(readHostedLocalBrowserEnvironmentValue(
      environment,
      "VALUE",
      RUNNER_NAME,
    )).toBe("configured");
    expect(() => readHostedLocalBrowserEnvironmentValue(
      environment,
      "MISSING",
      RUNNER_NAME,
    )).toThrow(`${RUNNER_NAME} requires MISSING.`);

    clearHostedLocalBrowserEnvironment(["SECRET", "VALUE"], environment);
    expect(environment).toEqual({ KEEP: "kept", NODE_ENV: "test" });
  });

  it("applies one bounded integer policy for browser timeouts", () => {
    const readTimeout = (value?: string) => readHostedLocalBrowserTimeout({
      defaultMs: 120_000,
      environment: {
        NODE_ENV: "test",
        ...(value === undefined ? {} : { TIMEOUT: value }),
      },
      key: "TIMEOUT",
      maximumMs: 300_000,
      minimumMs: 30_000,
      runnerName: RUNNER_NAME,
    });

    expect(readTimeout()).toBe(120_000);
    expect(readTimeout("45000")).toBe(45_000);
    for (const value of ["29999", "300000.5", "not-a-number"]) {
      expect(() => readTimeout(value)).toThrow(
        `${RUNNER_NAME} requires TIMEOUT to be an integer from 30000 to 300000.`,
      );
    }
  });

  it("frames browser results through the shared subprocess marker", () => {
    expect(formatHostedLocalBrowserResult({ ok: true })).toBe(
      'MURPH_E2E_RESULT={"ok":true}\n',
    );
  });

  it.each([
    "http://example.test",
    "https://localhost:3000",
  ])("rejects browser target %s before Chromium starts", async (webBaseUrl) => {
    await expect(execFileAsync(
      "pnpm",
      [
        "--dir",
        "apps/web",
        "exec",
        "tsx",
        "scripts/run-hosted-local-browser-smoke.ts",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          HOME: process.env.HOME,
          NODE_ENV: "test",
          PATH: process.env.PATH,
          PLAYWRIGHT_BROWSERS_PATH: fileURLToPath(
            new URL("./missing-playwright-browsers", import.meta.url),
          ),
          MURPH_E2E_BROWSER_TIMEOUT_MS: "30000",
          MURPH_E2E_HOSTED_SESSION_COOKIE: "murph-session=synthetic",
          MURPH_E2E_WEB_BASE_URL: webBaseUrl,
        },
        timeout: 30_000,
      },
    )).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Hosted browser smoke requires a loopback HTTP web URL.",
      ),
    });
  });
});

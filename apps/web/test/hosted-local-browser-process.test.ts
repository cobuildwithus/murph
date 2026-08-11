import { describe, expect, it } from "vitest";

import {
  buildHostedLocalBrowserSessionCookie,
  clearHostedLocalBrowserEnvironment,
  formatHostedLocalBrowserResult,
  readHostedLocalBrowserEnvironmentValue,
  readHostedLocalBrowserTimeout,
} from "../scripts/hosted-local-browser-process.ts";

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
    expect(environment).toEqual({ KEEP: "kept" });
  });

  it("applies one bounded integer policy for browser timeouts", () => {
    const readTimeout = (value?: string) => readHostedLocalBrowserTimeout({
      defaultMs: 120_000,
      environment: value === undefined ? {} : { TIMEOUT: value },
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
});

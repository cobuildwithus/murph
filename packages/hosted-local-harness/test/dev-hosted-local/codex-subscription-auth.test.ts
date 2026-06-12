import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MURPH_HOSTED_LOCAL_CODEX_HOME_ENV,
  resolveHostedLocalCodexHome,
  resolveHostedLocalCodexSubscriptionAuthEnvValue,
  shouldSeedHostedLocalCodexSubscriptionAuth,
} from "../../src/dev-hosted-local/codex-subscription-auth.ts";

const temporaryPaths: string[] = [];
const HOUR_MS = 60 * 60 * 1000;

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryPaths.splice(0).map((target) =>
      rm(target, { force: true, recursive: true })
    ),
  );
});

describe("shouldSeedHostedLocalCodexSubscriptionAuth", () => {
  it("seeds interactive dev and debug profiles outside NODE_ENV=test", () => {
    expect(shouldSeedHostedLocalCodexSubscriptionAuth({
      nodeEnv: undefined,
      profileName: undefined,
    })).toBe(true);
    expect(shouldSeedHostedLocalCodexSubscriptionAuth({
      nodeEnv: "development",
      profileName: "dev",
    })).toBe(true);
    expect(shouldSeedHostedLocalCodexSubscriptionAuth({
      nodeEnv: "development",
      profileName: "worker-only",
    })).toBe(true);
  });

  it("never seeds NODE_ENV=test or test-mode profiles", () => {
    expect(shouldSeedHostedLocalCodexSubscriptionAuth({
      nodeEnv: "test",
      profileName: "dev",
    })).toBe(false);
    // The profile gate holds even when NODE_ENV is not "test".
    expect(shouldSeedHostedLocalCodexSubscriptionAuth({
      nodeEnv: "development",
      profileName: "e2e:stub",
    })).toBe(false);
    expect(shouldSeedHostedLocalCodexSubscriptionAuth({
      nodeEnv: "development",
      profileName: "e2e:live",
    })).toBe(false);
  });
});

describe("resolveHostedLocalCodexHome", () => {
  it("defaults to ~/.codex-7", () => {
    expect(resolveHostedLocalCodexHome({})).toMatch(/[/\\]\.codex-7$/);
  });

  it("honors the configured Codex home env var with tilde expansion", () => {
    expect(
      resolveHostedLocalCodexHome({
        [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: "/explicit/codex-home",
      }),
    ).toBe("/explicit/codex-home");
    expect(
      resolveHostedLocalCodexHome({
        [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: "~/.codex-custom",
      }),
    ).toMatch(/[/\\]\.codex-custom$/);
  });
});

describe("resolveHostedLocalCodexSubscriptionAuthEnvValue", () => {
  it("returns a single-line minimal seed for a fresh ChatGPT login", async () => {
    const codexHome = await createCodexHome({
      ...buildChatGptAuth({ accessTokenExpiresInMs: 200 * HOUR_MS }),
      // Stray fields in the host file must never reach the runner.
      legacy_unknown_field: "host-only",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const value = await resolveHostedLocalCodexSubscriptionAuthEnvValue({
      [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: codexHome,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    // base64url: safe across dotenv-style env-file hops (no quotes/escapes).
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/u);
    const decodedJson = decodeSeedJson(value);
    const parsed = JSON.parse(decodedJson);
    expect(parsed.auth_mode).toBe("chatgpt");
    expect(parsed.tokens.access_token).toContain(".");
    expect(parsed.tokens.id_token).toBe("id-token-1");
    expect(parsed.tokens.account_id).toBe("account-1");
    // The durable account-scoped refresh token stays host-side.
    expect(parsed.tokens.refresh_token).toBe("");
    expect(decodedJson).not.toContain("refresh-token-1");
    expect(parsed.legacy_unknown_field).toBeUndefined();
    expect(parsed.OPENAI_API_KEY).toBeNull();
  });

  it("refreshes near-expiry tokens host-side and persists rotation back", async () => {
    const codexHome = await createCodexHome(
      buildChatGptAuth({ accessTokenExpiresInMs: 10 * HOUR_MS }),
    );
    const rotatedAccessToken = buildFakeJwt((Date.now() + 240 * HOUR_MS) / 1000);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: rotatedAccessToken,
          id_token: "id-token-2",
          refresh_token: "refresh-token-2",
        }),
        { status: 200 },
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const value = await resolveHostedLocalCodexSubscriptionAuthEnvValue({
      [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: codexHome,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(refreshUrl).toBe("https://auth.openai.com/oauth/token");
    expect(JSON.parse(String(refreshInit.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-token-1",
    });

    const decodedJson = decodeSeedJson(value);
    const seeded = JSON.parse(decodedJson);
    expect(seeded.tokens.access_token).toBe(rotatedAccessToken);
    expect(seeded.tokens.id_token).toBe("id-token-2");
    // Rotated refresh tokens are persisted host-side but never seeded.
    expect(seeded.tokens.refresh_token).toBe("");
    expect(decodedJson).not.toContain("refresh-token-2");

    // The rotated refresh token must land back in the host Codex home so the
    // host login survives runner container teardown.
    const authPath = path.join(codexHome, "auth.json");
    const persisted = JSON.parse(await readFile(authPath, "utf8"));
    expect(persisted.tokens.refresh_token).toBe("refresh-token-2");
    expect(Date.parse(persisted.last_refresh)).toBeGreaterThan(Date.now() - 60_000);
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);
  });

  it("continues on transient refresh failure while the token has safe runway", async () => {
    const codexHome = await createCodexHome(
      buildChatGptAuth({ accessTokenExpiresInMs: 48 * HOUR_MS }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 503 })));

    const value = await resolveHostedLocalCodexSubscriptionAuthEnvValue({
      [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: codexHome,
    });

    const decodedJson = decodeSeedJson(value);
    expect(JSON.parse(decodedJson).tokens.id_token).toBe("id-token-1");
    expect(decodedJson).not.toContain("refresh-token-1");
  });

  it("serializes concurrent refreshes so the shared refresh token rotates once", async () => {
    const codexHome = await createCodexHome(
      buildChatGptAuth({ accessTokenExpiresInMs: 10 * HOUR_MS }),
    );
    const rotatedAccessToken = buildFakeJwt((Date.now() + 240 * HOUR_MS) / 1000);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: rotatedAccessToken,
          refresh_token: "refresh-token-2",
        }),
        { status: 200 },
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = { [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: codexHome };
    const [first, second] = await Promise.all([
      resolveHostedLocalCodexSubscriptionAuthEnvValue(env),
      resolveHostedLocalCodexSubscriptionAuthEnvValue(env),
    ]);

    // Exactly one refresh; the second stack re-reads the rotated file.
    expect(fetchMock).toHaveBeenCalledOnce();
    for (const value of [first, second]) {
      expect(JSON.parse(decodeSeedJson(value)).tokens.access_token).toBe(rotatedAccessToken);
    }
  });

  it("fails closed when refresh fails near expiry", async () => {
    const codexHome = await createCodexHome(
      buildChatGptAuth({ accessTokenExpiresInMs: 2 * HOUR_MS }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));

    await expect(
      resolveHostedLocalCodexSubscriptionAuthEnvValue({
        [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: codexHome,
      }),
    ).rejects.toThrow(/codex login/);
  });

  it("fails with login guidance when auth.json is missing", async () => {
    const codexHome = await createTemporaryDirectory();

    await expect(
      resolveHostedLocalCodexSubscriptionAuthEnvValue({
        [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: codexHome,
      }),
    ).rejects.toThrow(/codex login/);
  });

  it("rejects API-key-mode Codex logins", async () => {
    const codexHome = await createCodexHome({
      OPENAI_API_KEY: "sk-direct-api-key",
      auth_mode: "apikey",
    });

    await expect(
      resolveHostedLocalCodexSubscriptionAuthEnvValue({
        [MURPH_HOSTED_LOCAL_CODEX_HOME_ENV]: codexHome,
      }),
    ).rejects.toThrow(/ChatGPT-subscription/);
  });
});

function decodeSeedJson(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function createTemporaryDirectory(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "codex-subscription-auth-"));
  temporaryPaths.push(target);
  return target;
}

async function createCodexHome(auth: Record<string, unknown>): Promise<string> {
  const codexHome = await createTemporaryDirectory();
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    path.join(codexHome, "auth.json"),
    `${JSON.stringify(auth, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return codexHome;
}

function buildChatGptAuth(input: { accessTokenExpiresInMs: number }): Record<string, unknown> {
  return {
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: buildFakeJwt((Date.now() + input.accessTokenExpiresInMs) / 1000),
      account_id: "account-1",
      id_token: "id-token-1",
      refresh_token: "refresh-token-1",
    },
  };
}

function buildFakeJwt(expSeconds: number): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({ exp: Math.floor(expSeconds) }),
    "signature",
  ].join(".");
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureCommandOutput: vi.fn(),
}));

vi.mock("../../src/dev-hosted-local/runtime.ts", () => ({
  captureCommandOutput: mocks.captureCommandOutput,
}));

import {
  parseHostedExecutionOidcIdentity,
  resolveVercelOidcToken,
} from "../../src/dev-hosted-local/vercel.ts";

beforeEach(() => {
  mocks.captureCommandOutput.mockReset();
});

describe("resolveVercelOidcToken", () => {
  it("keeps the web-only app-session signer out of the OIDC subprocess", async () => {
    mocks.captureCommandOutput.mockResolvedValue("oidc-token");

    await expect(resolveVercelOidcToken({
      DATABASE_URL: "postgresql://database.example.test/murph",
      HOSTED_APP_SESSION_HMAC_KEY: Buffer.alloc(32, 9).toString("base64url"),
      PATH: "/usr/bin",
    })).resolves.toBe("oidc-token");

    expect(mocks.captureCommandOutput).toHaveBeenCalledOnce();
    const childEnv = mocks.captureCommandOutput.mock.calls[0]?.[2].env;
    expect(childEnv?.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(childEnv?.DATABASE_URL).toBe("postgresql://database.example.test/murph");
  });
});

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

describe("parseHostedExecutionOidcIdentity", () => {
  it("parses the canonical Vercel OIDC issuer and subject claims", () => {
    expect(
      parseHostedExecutionOidcIdentity(
        createJwt({
          iss: "https://oidc.vercel.com/murph",
          sub: "owner:murph:project:murph-web:environment:development",
        }),
      ),
    ).toEqual({
      environment: "development",
      projectName: "murph-web",
      teamSlug: "murph",
    });
  });

  it("falls back to explicit owner, project, and environment claims", () => {
    expect(
      parseHostedExecutionOidcIdentity(
        createJwt({
          environment: "development",
          iss: "https://oidc.vercel.com/murph",
          owner: "murph",
          project: "murph-web",
          sub: "custom-subject-format",
        }),
      ),
    ).toEqual({
      environment: "development",
      projectName: "murph-web",
      teamSlug: "murph",
    });
  });

  it("rejects mismatched issuer and subject owners", () => {
    expect(() =>
      parseHostedExecutionOidcIdentity(
        createJwt({
          iss: "https://oidc.vercel.com/murph",
          sub: "owner:other-team:project:murph-web:environment:development",
        }),
      )
    ).toThrow("owner does not match its issuer");
  });

  it("rejects non-development tokens", () => {
    expect(() =>
      parseHostedExecutionOidcIdentity(
        createJwt({
          iss: "https://oidc.vercel.com/murph",
          sub: "owner:murph:project:murph-web:environment:preview",
        }),
      )
    ).toThrow("development-scoped Vercel OIDC token");
  });
});

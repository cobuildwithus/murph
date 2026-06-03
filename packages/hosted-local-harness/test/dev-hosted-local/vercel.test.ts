import { describe, expect, it } from "vitest";

import { parseHostedExecutionOidcIdentity } from "../../src/dev-hosted-local/vercel.ts";

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

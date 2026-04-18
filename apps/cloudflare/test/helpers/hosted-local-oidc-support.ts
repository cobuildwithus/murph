import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createServer } from "node:http";

import {
  stopHttpStubServer,
  writeJsonResponse,
} from "./hosted-local-e2e-support.js";

const DEFAULT_PROJECT_NAME = "murph-web";
const DEFAULT_TEAM_SLUG = "murph-local-dev";
const DEVELOPMENT_ENVIRONMENT = "development";
const HOSTED_LOCAL_OIDC_TOKEN_TTL_SECONDS = 3_600;

export interface HostedLocalOidcFixture {
  jwksUrl: string;
  stop(): Promise<void>;
  token: string;
}

export async function startHostedLocalOidcFixture(input: {
  projectName?: string;
  teamSlug?: string;
} = {}): Promise<HostedLocalOidcFixture> {
  const projectName = input.projectName?.trim() || DEFAULT_PROJECT_NAME;
  const teamSlug = input.teamSlug?.trim() || DEFAULT_TEAM_SLUG;
  const issuer = `https://oidc.vercel.com/${teamSlug}`;
  const audience = `https://vercel.com/${teamSlug}`;
  const subject = `owner:${teamSlug}:project:${projectName}:environment:${DEVELOPMENT_ENVIRONMENT}`;
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const publicJwk = {
    ...(createPublicKey(privateKey).export({ format: "jwk" }) as JsonWebKey),
    alg: "RS256",
    kid: "hosted-local-dev",
    use: "sig",
  };

  const server = createServer((request, response) => {
    if (request.url !== "/.well-known/jwks") {
      response.statusCode = 404;
      response.end();
      return;
    }

    writeJsonResponse(response, 200, { keys: [publicJwk] });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await stopHttpStubServer(server);
    throw new Error("Expected the hosted local OIDC fixture to bind a TCP port.");
  }

  return {
    jwksUrl: `http://127.0.0.1:${address.port}/.well-known/jwks`,
    async stop(): Promise<void> {
      await stopHttpStubServer(server);
    },
    token: createDevelopmentOidcToken({
      audience,
      issuer,
      privateKey,
      projectName,
      subject,
      teamSlug,
    }),
  };
}

function createDevelopmentOidcToken(input: {
  audience: string;
  issuer: string;
  privateKey: KeyObject;
  projectName: string;
  subject: string;
  teamSlug: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: "hosted-local-dev",
    typ: "JWT",
  };
  const payload = {
    aud: input.audience,
    environment: DEVELOPMENT_ENVIRONMENT,
    exp: now + HOSTED_LOCAL_OIDC_TOKEN_TTL_SECONDS,
    iat: now,
    iss: input.issuer,
    owner: input.teamSlug,
    project: input.projectName,
    sub: input.subject,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), input.privateKey);

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

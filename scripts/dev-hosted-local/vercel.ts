import { access } from "node:fs/promises";

import { repoRoot, vercelLinkCandidatePaths } from "./constants.ts";
import { captureCommandOutput } from "./runtime.ts";
import type { HostedExecutionOidcIdentity } from "./types.ts";

export async function ensureVercelLinkExists(): Promise<void> {
  for (const filePath of vercelLinkCandidatePaths) {
    try {
      await access(filePath);
      return;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    [
      "This repo is not linked to the hosted web Vercel project.",
      "Run `cd apps/web && vercel link`, or run `vercel link --repo` from the repo root, before using `pnpm dev`.",
    ].join(" "),
  );
}

export async function resolveVercelOidcToken(env: NodeJS.ProcessEnv): Promise<string> {
  const existing = env.VERCEL_OIDC_TOKEN?.trim();

  if (existing) {
    return existing;
  }

  const token = await captureCommandOutput(
    "pnpm",
    [
      "--dir",
      "apps/web",
      "exec",
      "node",
      "-e",
      [
        "const { getVercelOidcToken } = require('@vercel/oidc');",
        "getVercelOidcToken()",
        "  .then((token) => process.stdout.write(token))",
        "  .catch((error) => {",
        "    console.error(error instanceof Error ? error.message : String(error));",
        "    process.exit(1);",
        "  });",
      ].join(""),
    ],
    {
      cwd: repoRoot,
      env,
      name: "setup",
    },
  );

  const normalized = token.trim();

  if (!normalized) {
    throw new Error(
      "Failed to load a Vercel OIDC token for local hosted dev. Make sure Vercel CLI is logged in, the project is linked, and OIDC is enabled.",
    );
  }

  return normalized;
}

export function parseHostedExecutionOidcIdentity(token: string): HostedExecutionOidcIdentity {
  const payload = parseJwtPayload(token);
  const issuer = typeof payload.iss === "string" ? payload.iss.trim() : "";
  const issuerMatch = /^https:\/\/oidc\.vercel\.com\/([^/]+)$/u.exec(issuer);
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const subjectMatch =
    /^owner:([^:]+):project:([^:]+):environment:(development|preview|production)$/u.exec(subject);
  const environment = normalizeOidcEnvironment(
    typeof payload.environment === "string" ? payload.environment : subjectMatch?.[3],
  );
  const teamSlug = issuerMatch?.[1] ?? readOidcClaim(payload.owner);
  const projectName = subjectMatch?.[2] ?? readOidcClaim(payload.project);

  if (!teamSlug || !projectName || !environment) {
    throw new Error("Could not derive the Vercel OIDC validation identity for local Cloudflare dev.");
  }

  if (subjectMatch?.[1] && subjectMatch[1] !== teamSlug) {
    throw new Error("The local Vercel OIDC token owner does not match its issuer.");
  }

  if (environment !== "development") {
    throw new Error(
      `Local hosted dev expects a development-scoped Vercel OIDC token, received ${JSON.stringify(environment)}.`,
    );
  }

  return {
    environment,
    projectName,
    teamSlug,
  };
}

function parseJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");

  if (parts.length < 2) {
    throw new Error("VERCEL_OIDC_TOKEN must be a JWT.");
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `VERCEL_OIDC_TOKEN must contain a valid JWT payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readOidcClaim(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOidcEnvironment(
  value: string | undefined,
): HostedExecutionOidcIdentity["environment"] | null {
  if (!value) {
    return null;
  }

  if (value === "development" || value === "preview" || value === "production") {
    return value;
  }

  return null;
}

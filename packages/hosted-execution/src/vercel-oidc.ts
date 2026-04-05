import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";

const DEFAULT_HOSTED_EXECUTION_VERCEL_OIDC_CLOCK_TOLERANCE_SECONDS = 60;
const HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENTS = [
  "development",
  "preview",
  "production",
] as const;

type EnvSource = Readonly<Record<string, string | undefined>>;
type RemoteJwkSet = ReturnType<typeof createRemoteJWKSet>;

const remoteJwkSetCache = new Map<string, RemoteJwkSet>();

export type HostedExecutionVercelOidcEnvironmentName =
  (typeof HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENTS)[number];

export interface HostedExecutionVercelOidcValidationEnvironment {
  audience: string;
  environment: HostedExecutionVercelOidcEnvironmentName;
  issuer: string;
  jwksUrl: string;
  projectName: string;
  subject: string;
  teamSlug: string;
}

export interface HostedExecutionVercelOidcClaims extends JWTPayload {
  environment?: string;
  owner?: string;
  owner_id?: string;
  project?: string;
  project_id?: string;
}

export function readBearerAuthorizationToken(value: string | null): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized || !normalized.startsWith("Bearer ")) {
    return null;
  }

  const token = normalized.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function readHostedExecutionVercelOidcValidationEnvironment(
  source: EnvSource = process.env,
): HostedExecutionVercelOidcValidationEnvironment | null {
  const teamSlug = normalizeOptionalString(source.HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG);
  const projectName = normalizeOptionalString(source.HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME);

  if (!teamSlug || !projectName) {
    return null;
  }

  const environment = parseHostedExecutionVercelOidcEnvironmentName(
    source.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT,
  ) ?? "production";

  return createHostedExecutionVercelOidcValidationEnvironment({
    environment,
    projectName,
    teamSlug,
  });
}

export function requireHostedExecutionVercelOidcValidationEnvironment(
  source: EnvSource = process.env,
): HostedExecutionVercelOidcValidationEnvironment {
  const validation = readHostedExecutionVercelOidcValidationEnvironment(source);

  if (!validation) {
    throw new TypeError(
      "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG and HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME are required.",
    );
  }

  return validation;
}

export async function verifyHostedExecutionVercelOidcBearerToken(input: {
  clockToleranceSeconds?: number;
  token: string;
  validation: HostedExecutionVercelOidcValidationEnvironment;
}): Promise<HostedExecutionVercelOidcClaims | null> {
  const token = normalizeOptionalString(input.token);

  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(
      token,
      resolveHostedExecutionVercelOidcJwkSet(input.validation.jwksUrl),
      {
        algorithms: ["RS256"],
        audience: input.validation.audience,
        clockTolerance:
          input.clockToleranceSeconds
          ?? DEFAULT_HOSTED_EXECUTION_VERCEL_OIDC_CLOCK_TOLERANCE_SECONDS,
        issuer: input.validation.issuer,
        subject: input.validation.subject,
      },
    );

    return verified.payload as HostedExecutionVercelOidcClaims;
  } catch {
    return null;
  }
}

export async function verifyHostedExecutionVercelOidcRequest(input: {
  clockToleranceSeconds?: number;
  request: Request;
  validation: HostedExecutionVercelOidcValidationEnvironment;
}): Promise<HostedExecutionVercelOidcClaims | null> {
  const token = readBearerAuthorizationToken(input.request.headers.get("authorization"));

  if (!token) {
    return null;
  }

  return verifyHostedExecutionVercelOidcBearerToken({
    clockToleranceSeconds: input.clockToleranceSeconds,
    token,
    validation: input.validation,
  });
}

export function createHostedExecutionVercelOidcValidationEnvironment(input: {
  environment: HostedExecutionVercelOidcEnvironmentName;
  projectName: string;
  teamSlug: string;
}): HostedExecutionVercelOidcValidationEnvironment {
  const teamSlug = requireOpaqueIdentifierSegment(input.teamSlug, "teamSlug");
  const projectName = requireOpaqueIdentifierSegment(input.projectName, "projectName");

  return {
    audience: `https://vercel.com/${teamSlug}`,
    environment: input.environment,
    issuer: `https://oidc.vercel.com/${teamSlug}`,
    jwksUrl: `https://oidc.vercel.com/${teamSlug}/.well-known/jwks`,
    projectName,
    subject: `owner:${teamSlug}:project:${projectName}:environment:${input.environment}`,
    teamSlug,
  };
}

function parseHostedExecutionVercelOidcEnvironmentName(
  value: string | undefined,
): HostedExecutionVercelOidcEnvironmentName | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  if (
    !HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENTS.includes(
      normalized as HostedExecutionVercelOidcEnvironmentName,
    )
  ) {
    throw new TypeError(
      "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT must be one of development, preview, or production.",
    );
  }

  return normalized as HostedExecutionVercelOidcEnvironmentName;
}

function resolveHostedExecutionVercelOidcJwkSet(jwksUrl: string): RemoteJwkSet {
  const existing = remoteJwkSetCache.get(jwksUrl);

  if (existing) {
    return existing;
  }

  const next = createRemoteJWKSet(new URL(jwksUrl));
  remoteJwkSetCache.set(jwksUrl, next);
  return next;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireOpaqueIdentifierSegment(value: string, label: string): string {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw new TypeError(`${label} must be configured.`);
  }

  if (/[:\s]/u.test(normalized)) {
    throw new TypeError(`${label} must not contain whitespace or colon separators.`);
  }

  return normalized;
}

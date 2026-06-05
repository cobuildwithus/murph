import { timingSafeEqual } from "node:crypto";

import {
  runResetHostedMemberRuntimeCommand,
  safeErrorMessage,
} from "@/scripts/reset-hosted-member-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ResetRouteBody {
  confirmEnvironment?: string;
  confirmMemberId?: string;
  confirmTargetFingerprint?: string;
  memberId?: string;
  mode?: string;
  resumeSuspendedReset?: boolean;
  unsuspendAfterReset?: boolean;
}

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Hosted member reset admin route only allows POST.",
    },
  }, {
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
    },
    status: 405,
  });
}

export async function POST(request: Request): Promise<Response> {
  let requestedMemberId: string | null = null;

  try {
    requireHostedMemberResetAdminRequest(request);
    const body = await readResetRouteBody(request);
    requestedMemberId = body.memberId ?? null;
    const args = buildResetCommandArgs(body);
    const events = await runResetHostedMemberRuntimeCommand(args);
    const targetFingerprint = readExecutionTargetFingerprint(events);

    return Response.json({
      events,
      ok: true,
      targetFingerprint,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof ResetRouteError ? error.status : 500;
    return Response.json({
      error: {
        code: error instanceof ResetRouteError ? error.code : "HOSTED_MEMBER_RESET_FAILED",
        message: safeErrorMessage(error, requestedMemberId),
      },
      ok: false,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
      status,
    });
  }
}

function requireHostedMemberResetAdminRequest(request: Request): void {
  const expectedToken = process.env.HOSTED_MEMBER_RESET_ADMIN_TOKEN?.trim();
  if (!expectedToken) {
    throw new ResetRouteError(
      "HOSTED_MEMBER_RESET_ADMIN_TOKEN_NOT_CONFIGURED",
      "Hosted member reset admin token is not configured.",
      503,
    );
  }

  const providedToken = readBearerToken(request.headers.get("authorization"));
  if (!providedToken || !constantTimeEquals(providedToken, expectedToken)) {
    throw new ResetRouteError(
      "HOSTED_MEMBER_RESET_ADMIN_UNAUTHORIZED",
      "Hosted member reset admin request is not authorized.",
      401,
    );
  }
}

async function readResetRouteBody(request: Request): Promise<ResetRouteBody> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ResetRouteError(
      "HOSTED_MEMBER_RESET_INVALID_JSON",
      "Hosted member reset admin request body must be valid JSON.",
      400,
    );
  }

  if (!isRecord(parsed)) {
    throw new ResetRouteError(
      "HOSTED_MEMBER_RESET_INVALID_BODY",
      "Hosted member reset admin request body must be a JSON object.",
      400,
    );
  }

  return {
    confirmEnvironment: readOptionalString(parsed.confirmEnvironment),
    confirmMemberId: readOptionalString(parsed.confirmMemberId),
    confirmTargetFingerprint: readOptionalString(parsed.confirmTargetFingerprint),
    memberId: readOptionalString(parsed.memberId),
    mode: readOptionalString(parsed.mode),
    resumeSuspendedReset: parsed.resumeSuspendedReset === true ? true : undefined,
    unsuspendAfterReset: parsed.unsuspendAfterReset === true ? true : undefined,
  };
}

function buildResetCommandArgs(body: ResetRouteBody): string[] {
  const memberId = readNonEmptyString(body.memberId, "memberId");
  const mode = readNonEmptyString(body.mode, "mode");
  const args = [
    "--member-id",
    memberId,
    "--environment",
    "production",
  ];

  switch (mode) {
    case "dry-run":
      args.push("--dry-run");
      return args;
    case "execute":
      return buildExecuteResetCommandArgs(args, body, memberId);
    default:
      throw new ResetRouteError(
        "HOSTED_MEMBER_RESET_INVALID_MODE",
        "Hosted member reset mode must be dry-run or execute.",
        400,
      );
  }
}

function buildExecuteResetCommandArgs(
  baseArgs: string[],
  body: ResetRouteBody,
  memberId: string,
): string[] {
  const confirmMemberId = readNonEmptyString(body.confirmMemberId, "confirmMemberId");
  const confirmEnvironment = readNonEmptyString(body.confirmEnvironment, "confirmEnvironment");
  const confirmTargetFingerprint = readNonEmptyString(
    body.confirmTargetFingerprint,
    "confirmTargetFingerprint",
  );

  if (confirmMemberId !== memberId) {
    throw new ResetRouteError(
      "HOSTED_MEMBER_RESET_CONFIRM_MEMBER_MISMATCH",
      "Hosted member reset execute confirmation must match memberId.",
      400,
    );
  }
  if (confirmEnvironment !== "production") {
    throw new ResetRouteError(
      "HOSTED_MEMBER_RESET_CONFIRM_ENVIRONMENT_MISMATCH",
      "Hosted member reset execute confirmation must target production.",
      400,
    );
  }
  if (body.unsuspendAfterReset !== true) {
    throw new ResetRouteError(
      "HOSTED_MEMBER_RESET_UNSUSPEND_REQUIRED",
      "Hosted member reset execute requires unsuspendAfterReset=true.",
      400,
    );
  }

  const args = [
    ...baseArgs,
    "--execute",
    "--confirm-member-id",
    confirmMemberId,
    "--confirm-environment",
    confirmEnvironment,
    "--confirm-target-fingerprint",
    confirmTargetFingerprint,
    "--unsuspend-after-reset",
    "--confirm-unsuspend-after-reset",
    confirmMemberId,
  ];

  if (body.resumeSuspendedReset === true) {
    args.push("--resume-suspended-reset");
  }

  return args;
}

function readExecutionTargetFingerprint(events: Array<Record<string, unknown>>): string | null {
  const start = events.find((event) => event.step === "start");
  const targets = start?.targets;
  if (!isRecord(targets)) {
    return null;
  }

  const fingerprint = targets.executionTargetFingerprint;
  return typeof fingerprint === "string" && fingerprint.trim().length > 0
    ? fingerprint
    : null;
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new ResetRouteError(
    "HOSTED_MEMBER_RESET_INVALID_FIELD",
    `Hosted member reset request requires ${field}.`,
    400,
  );
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBearerToken(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(trimmed);
  return match?.[1]?.trim() || null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

class ResetRouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

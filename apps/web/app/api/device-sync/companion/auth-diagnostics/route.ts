import {
  validateCompanionAuthDiagnosticRequestBody,
} from "@/src/lib/device-sync/companion";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { deviceSyncError } from "@murphai/device-syncd/errors";

const COMPANION_AUTH_DIAGNOSTIC_BODY_LIMIT_BYTES = 8 * 1024;
const COMPANION_AUTH_DIAGNOSTIC_THROTTLE_WINDOW_MS = 60_000;
const COMPANION_AUTH_DIAGNOSTIC_THROTTLE_LIMIT = 30;
const COMPANION_AUTH_DIAGNOSTIC_AGGREGATE_LIMIT = 300;
const COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV =
  "MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED";

const authDiagnosticThrottleCounts = new Map<string, number>();
let authDiagnosticThrottleResetAt = 0;
let authDiagnosticThrottleTotal = 0;

export const POST = withJsonError(async (request: Request) => {
  if (!isCompanionAuthDiagnosticsEnabled()) {
    return new Response(null, {
      headers: { "Cache-Control": "no-store" },
      status: 404,
    });
  }

  const throttleResponse = consumeCompanionAuthDiagnosticThrottle(request);
  if (throttleResponse) {
    return throttleResponse;
  }

  const diagnostic = validateCompanionAuthDiagnosticRequestBody(
    await readAuthDiagnosticBody(request),
  );

  console.warn("Companion auth diagnostic.", diagnostic);

  return jsonOk({ ok: true });
});

async function readAuthDiagnosticBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await readOptionalJsonObject(request, {
      limitBytes: COMPANION_AUTH_DIAGNOSTIC_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw deviceSyncError({
        code: "COMPANION_REQUEST_INVALID",
        message: "Auth diagnostic body must be valid JSON.",
        retryable: false,
        httpStatus: 400,
      });
    }
    throw error;
  }
}

function isCompanionAuthDiagnosticsEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    || process.env[COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV] === "1";
}

function consumeCompanionAuthDiagnosticThrottle(request: Request): Response | null {
  const now = Date.now();
  if (authDiagnosticThrottleResetAt <= now) {
    authDiagnosticThrottleCounts.clear();
    authDiagnosticThrottleResetAt = now + COMPANION_AUTH_DIAGNOSTIC_THROTTLE_WINDOW_MS;
    authDiagnosticThrottleTotal = 0;
  }

  if (authDiagnosticThrottleTotal >= COMPANION_AUTH_DIAGNOSTIC_AGGREGATE_LIMIT) {
    return authDiagnosticRateLimitedResponse("Too many companion auth diagnostics.");
  }

  const clientKey = readThrottleClientKey(request);
  const count = (authDiagnosticThrottleCounts.get(clientKey) ?? 0) + 1;
  if (count > COMPANION_AUTH_DIAGNOSTIC_THROTTLE_LIMIT) {
    return authDiagnosticRateLimitedResponse(
      "Too many companion auth diagnostics from this client.",
    );
  }
  authDiagnosticThrottleCounts.set(clientKey, count);
  authDiagnosticThrottleTotal += 1;

  return null;
}

function readThrottleClientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  const candidate = forwardedFor.split(",", 1)[0]?.trim() || "unknown";

  return candidate.replace(/[^A-Za-z0-9:.:-]/gu, "").slice(0, 80) || "unknown";
}

function authDiagnosticRateLimitedResponse(message: string): Response {
  return jsonOk({
    error: {
      code: "COMPANION_AUTH_DIAGNOSTIC_RATE_LIMITED",
      message,
      retryable: true,
    },
  }, 429);
}

import {
  validateCompanionAuthDiagnosticRequestBody,
} from "@/src/lib/device-sync/companion";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { deviceSyncError } from "@murphai/device-syncd/errors";

const COMPANION_AUTH_DIAGNOSTIC_BODY_LIMIT_BYTES = 8 * 1024;
const COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV =
  "MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED";

export const POST = withJsonError(async (request: Request) => {
  if (!isCompanionAuthDiagnosticsEnabled()) {
    return new Response(null, {
      headers: { "Cache-Control": "no-store" },
      status: 404,
    });
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

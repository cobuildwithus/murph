import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  buildHostedDataExport,
  parseHostedDataExportRequest,
} from "@/src/lib/hosted-privacy/account-data-service";
import {
  HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES,
  buildHostedDataExportFilename,
  HOSTED_DATA_EXPORT_MIME_TYPE,
} from "@/src/lib/hosted-privacy/account-data-shared";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(
    JSON.stringify({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Data export requires a confirmed POST request from Settings.",
      },
    }),
    {
      headers: {
        "Allow": "POST",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
      status: 405,
    },
  );
}

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  parseHostedDataExportRequest(await readJsonObject(request, {
    limitBytes: HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES,
  }));

  const exportBundle = await buildHostedDataExport({
    memberId: auth.member.id,
    prisma,
  });
  const generatedAt = typeof exportBundle.generatedAt === "string"
    ? exportBundle.generatedAt
    : new Date().toISOString();
  const filename = buildHostedDataExportFilename(generatedAt);

  return new Response(JSON.stringify(exportBundle, null, 2), {
    headers: {
      "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": HOSTED_DATA_EXPORT_MIME_TYPE,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  });
});

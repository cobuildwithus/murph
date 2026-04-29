import { buildHostedAccountDataExport } from "@/src/lib/hosted-privacy/account-data-service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuth(request, prisma);
  const payload = await buildHostedAccountDataExport({
    memberId: auth.member.id,
    prisma,
  });

  const exportDate = new Date().toISOString().slice(0, 10);

  return jsonOk(payload, 200, {
    "Content-Disposition": `attachment; filename="murph-data-export-${exportDate}.json"`,
  });
});

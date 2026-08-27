import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import {
  renewIMessageMiniAppCredential,
  validateIMessageMiniAppRenewalBody,
} from "@/src/lib/imessage-mini-app/service";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  validateIMessageMiniAppRenewalBody(await readJsonObject(request, {
    limitBytes: 1_024,
  }));
  const prisma = getPrisma();

  return jsonOk(await renewIMessageMiniAppCredential({
    prisma,
    request,
  }));
});

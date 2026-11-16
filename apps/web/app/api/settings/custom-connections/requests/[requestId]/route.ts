import { settingsActionRequest } from "@/src/lib/custom-connections/settings-http";
export const POST = async (request: Request, context: { params: Promise<{ requestId: string }> }) =>
  settingsActionRequest(request, (await context.params).requestId);

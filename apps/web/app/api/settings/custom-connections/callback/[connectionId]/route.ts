import { settingsConnections } from "@/src/lib/custom-connections/settings-http";
export const GET = async (request: Request, context: { params: Promise<{ connectionId: string }> }) =>
  settingsConnections(request, (await context.params).connectionId, "callback");

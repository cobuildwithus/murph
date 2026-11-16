import { settingsConnections } from "@/src/lib/custom-connections/settings-http";
export const POST = async (request: Request, context: { params: Promise<{ id: string }> }) =>
  settingsConnections(request, (await context.params).id, "refresh");

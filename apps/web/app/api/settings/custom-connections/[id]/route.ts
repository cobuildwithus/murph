import { settingsConnections } from "@/src/lib/custom-connections/settings-http";
type Context = { params: Promise<{ id: string }> };
export const PATCH = async (request: Request, context: Context) => settingsConnections(request, (await context.params).id);
export const DELETE = PATCH;

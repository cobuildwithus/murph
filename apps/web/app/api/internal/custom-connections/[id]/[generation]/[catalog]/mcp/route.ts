import { handleConnectionMcp } from "@/src/lib/custom-connections/gateway";
export const POST = async (request: Request, context: { params: Promise<{ id: string; generation: string; catalog: string }> }) =>
  handleConnectionMcp(request, await context.params);

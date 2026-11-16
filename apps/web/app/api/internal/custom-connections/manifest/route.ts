import { connectionMemberActive, requireConnectionCallback } from "@/src/lib/custom-connections/access";
import { connectionManifest } from "@/src/lib/custom-connections/service";
import { connectionErrorResponse } from "@/src/lib/custom-connections/errors";
export async function POST(request: Request) {
  try {
    const memberId = await requireConnectionCallback(request);
    const result = await connectionMemberActive(memberId) ? await connectionManifest(memberId) : { connections: [] };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return connectionErrorResponse(error); }
}

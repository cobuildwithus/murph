import { getPrisma } from "@/src/lib/prisma";
import { connectionMemberActive } from "@/src/lib/custom-connections/access";
import { connectionClientMetadata } from "@/src/lib/custom-connections/oauth";
export async function GET(_request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await context.params;
  const row = await getPrisma().hostedMcpConnection.findUnique({ where: { id: connectionId }, select: { memberId: true } });
  if (!row || !await connectionMemberActive(row.memberId)) return new Response(null, { status: 404 });
  return Response.json({ client_id: `https://www.withmurph.ai/oauth/mcp-client/${encodeURIComponent(connectionId)}`,
    ...connectionClientMetadata(connectionId) }, { headers: { "Cache-Control": "no-store" } });
}

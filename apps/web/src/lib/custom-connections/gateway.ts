import "server-only";

import { createMcpHandler, Server, isCallToolResult, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { getPrisma } from "../prisma";
import { connectionMemberActive, requireConnectionCallback } from "./access";
import { approvedSnapshot, storedToolsSchema } from "./catalog";
import { ConnectionError, connectionErrorResponse, connectionMessages } from "./errors";
import { readConnection } from "./store";
import { withConnectionClient } from "./upstream";

export async function admitGateway(request: Request, coordinates: { id: string; generation: string; catalog: string }) {
  const memberId = await requireConnectionCallback(request);
  if (!await connectionMemberActive(memberId)) throw new ConnectionError("not_found", 404);
  const row = await readConnection(memberId, coordinates.id);
  if (row.status !== "on" || String(row.generation) !== coordinates.generation || row.catalog !== coordinates.catalog) {
    throw new ConnectionError("not_found", 404);
  }
  return row;
}
async function readApprovedConnection(admitted: { memberId: string; id: string; generation: number; catalog: string }, tool: string) {
  const current = await readConnection(admitted.memberId, admitted.id);
  const approved = approvedSnapshot(storedToolsSchema.parse(current.tools));
  if (current.status !== "on" || current.generation !== admitted.generation || current.catalog !== admitted.catalog
    || !approved.some((definition) => definition.name === tool)) throw new ConnectionError("not_found", 403);
  return current;
}
export async function handleConnectionMcp(request: Request, coordinates: { id: string; generation: string; catalog: string }): Promise<Response> {
  try {
    const admitted = await admitGateway(request, coordinates);
    if ((await request.clone().text()).trimStart().startsWith("[")) {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported." } }, {
        status: 400, headers: { "Cache-Control": "no-store" },
      });
    }
    const createServer = () => {
      const server = new Server({ name: "murph-connection", version: "1.0.0" }, { capabilities: { tools: {} } });
      server.setRequestHandler("tools/list", async () => ({ tools: approvedSnapshot(storedToolsSchema.parse(admitted.tools)) }));
      server.setRequestHandler("tools/call", async (rpc) => {
        try {
          // Approval is checked before sign-in and setup, and again just before the call
          // leaves Web, since a refresh or a slow server can give the member time to revoke it.
          const current = await readApprovedConnection(admitted, rpc.params.name);
          const result = await withConnectionClient(current, async (client, options) => {
            await readApprovedConnection(admitted, rpc.params.name);
            return await client.callTool({ name: rpc.params.name, arguments: rpc.params.arguments }, options);
          });
          if (!isCallToolResult(result)) throw new ConnectionError("not_mcp");
          if (Buffer.byteLength(JSON.stringify(result)) > 262144) throw new ConnectionError("limit");
          await getPrisma().hostedMcpConnection.updateMany({ where: { id: current.id, generation: current.generation, status: "on" }, data: { lastUsedAt: new Date() } });
          return { content: result.content, structuredContent: result.structuredContent, isError: result.isError };
        } catch (error) {
          const message = error instanceof ConnectionError ? connectionMessages[error.code] : connectionMessages.unreachable;
          return { isError: true, content: [{ type: "text" as const, text: message }] };
        }
      });
      return server;
    };
    // SDK 2.4's built-in stateless legacy leg always uses SSE. Compose the
    // SDK's stateless JSON transport so both protocol eras honor this route's
    // JSON-only contract without patching or implementing a protocol transport.
    let response: Response;
    if (await isLegacyRequest(request.clone(), undefined, { maxRequestBodySize: 262144 })) {
      const server = createServer();
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 262144 });
      try {
        await server.connect(transport);
        response = await transport.handleRequest(request);
      } finally { await server.close(); }
    } else {
      const handler = createMcpHandler(createServer, { legacy: "reject", responseMode: "json", maxRequestBodySize: 262144, onerror: () => undefined });
      response = await handler.fetch(request);
    }
    return new Response(response.body, { status: response.status, headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store",
    } });
  } catch (error) { return connectionErrorResponse(error); }
}

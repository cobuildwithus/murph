import "server-only";

import { createMcpHandler, Server, isCallToolResult, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { connectionMemberActive, requireConnectionCallback } from "./access";
import { requestAction } from "./action-requests";
import { approvedSnapshot, approvedTool, storedToolsSchema, toolKind } from "./catalog";
import { ConnectionError, connectionErrorResponse, connectionMessages } from "./errors";
import { markConnectionUsed, readConnection } from "./store";
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
async function readApprovedConnection(admitted: { memberId: string; id: string; generation: number; catalog: string }, name: string) {
  const current = await readConnection(admitted.memberId, admitted.id);
  const tool = approvedTool(storedToolsSchema.parse(current.tools), name);
  if (current.status !== "on" || current.generation !== admitted.generation || current.catalog !== admitted.catalog
    || !tool) throw new ConnectionError("not_found", 403);
  return { current, tool };
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
      server.setRequestHandler("tools/list", async () => ({ tools: approvedSnapshot(storedToolsSchema.parse(admitted.tools), admitted.name) }));
      server.setRequestHandler("tools/call", async (rpc) => {
        try {
          // Approval is checked before sign-in and setup, and again just before the call
          // leaves Web, since a refresh or a slow server can give the member time to revoke it.
          const { current, tool } = await readApprovedConnection(admitted, rpc.params.name);
          // A write never leaves Web from here: it waits for the member's OK on a Murph page.
          if (toolKind(tool.definition) === "write") return await requestAction(current, tool, rpc.params.arguments ?? {});
          const result = await withConnectionClient(current, async (client, options) => {
            await readApprovedConnection(admitted, rpc.params.name);
            return await client.callTool({ name: rpc.params.name, arguments: rpc.params.arguments }, options);
          });
          if (!isCallToolResult(result)) throw new ConnectionError("not_mcp");
          if (Buffer.byteLength(JSON.stringify(result)) > 262144) throw new ConnectionError("limit");
          await markConnectionUsed(current);
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

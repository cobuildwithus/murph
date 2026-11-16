import "server-only";

import * as z from "@murphai/contracts/zod-runtime";
import { readHostedOnboardingJsonObject } from "../hosted-onboarding/http";
import { requireConnectionSession } from "./access";
import { connectionErrorResponse } from "./errors";
import { readConnection, projectConnection, connectionWhere } from "./store";
import { getPrisma } from "../prisma";
import { addConnection, patchConnection, refreshConnection, removeConnection, startConnectionSignIn, finishConnectionSignIn } from "./service";

async function body(request: Request) {
  return readHostedOnboardingJsonObject(request, { limitBytes: 16384,
    tooLargeErrorCode: "CUSTOM_CONNECTION_BODY_TOO_LARGE", tooLargeErrorMessage: "The request is too large." });
}
export async function settingsConnections(request: Request, id?: string, action?: "refresh" | "sign-in" | "callback"): Promise<Response> {
  try {
    const session = await requireConnectionSession(request, request.method !== "GET");
    if (action === "callback" && id) {
      try {
        await finishConnectionSignIn(request, session, id);
        return callbackRedirect(id, "step", "choose");
      } catch { return callbackRedirect(id, "error", "sign_in_unsupported"); }
    }
    if (!id && request.method === "GET") {
      const rows = await getPrisma().hostedMcpConnection.findMany({ where: connectionWhere(session.member.id), take: 10, orderBy: { createdAt: "asc" } });
      return json({ connections: rows.map(projectConnection) });
    }
    if (!id && request.method === "POST") {
      const input = z.object({ url: z.string().max(2048) }).strict().parse(await body(request));
      return json(await addConnection(request, session, input.url));
    }
    const row = await readConnection(session.member.id, id ?? "");
    if (action === "refresh") return json({ connection: projectConnection(await refreshConnection(row, { request, session })) });
    if (action === "sign-in") return json(await startConnectionSignIn(row, { request, session }));
    if (request.method === "PATCH") {
      const input = z.object({ revision: z.number().int().nonnegative(), tools: z.record(z.string().max(128), z.boolean()).optional(), status: z.enum(["on", "off"]).optional() }).strict().parse(await body(request));
      return json({ connection: projectConnection(await patchConnection(row, input, { request, session })) });
    }
    if (request.method === "DELETE") {
      await removeConnection(row, { request, session });
      return json({ removed: true });
    }
    return new Response(null, { status: 405 });
  } catch (error) { return connectionErrorResponse(error); }
}
function json(value: unknown) { return Response.json(value, { headers: { "Cache-Control": "no-store" } }); }
function callbackRedirect(id: string, key: string, value: string) {
  const query = new URLSearchParams({ connection: id, [key]: value });
  return new Response(null, { status: 303, headers: { Location: `/settings/connections?${query}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

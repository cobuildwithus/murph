import "server-only";

import { randomBytes } from "node:crypto";
import { isCallToolResult } from "@modelcontextprotocol/client";
import * as z from "@murphai/contracts/zod-runtime";
import type { HostedMcpActionRequest, Prisma } from "@prisma/client";
import { createHostedCustomConnectionActionLookupKeys } from "../hosted-onboarding/contact-privacy";
import { getPrisma } from "../prisma";
import { approvedTool, canonical, storedToolsSchema, type StoredTool } from "./catalog";
import { ConnectionError } from "./errors";
import { WEB_ORIGIN } from "./oauth";
import { openActionSecret, sealActionSecret } from "./secrets";
import { settingsMutation, type SettingsMutation } from "./service";
import { markConnectionUsed, readConnection, type ConnectionRow } from "./store";
import { withConnectionClient, type ConnectionWrite } from "./upstream";

/** A waiting request is open for an hour; a decided one answers the same call for an hour after its decision. */
const ACTION_WINDOW_MS = 3_600_000;
const WAITING_MAX = 20;
const ARGUMENTS_MAX_BYTES = 16_384;
const RESULT_MAX_BYTES = 262_144;
const RESULT_TEXT_MAX = 2_000;
export const ACTION_REQUEST_ID = /^car_[0-9a-f]{32}$/u;

const ACTION_FAILURES = ["off", "signed_out", "changed", "unreachable", "refused"] as const;
/** Why a request failed before its tool call left Web. */
export type ActionFailure = (typeof ACTION_FAILURES)[number];
export type ActionOutcome =
  | { status: "waiting" | "expired" | "declined" }
  | { status: "done" | "unknown"; text?: string }
  | { status: "failed"; reason: ActionFailure };
const storedResultSchema = z.object({ text: z.string().optional(), reason: z.enum(ACTION_FAILURES).optional() }).strict();

type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };
function answer(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true as const } : {}) };
}
function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
export function actionRequestUrl(id: string): string {
  return `${WEB_ORIGIN}/settings/connections/confirm/${id}`;
}

/**
 * The gateway's answer to an approved write: it records exactly what Murph asked for and returns the member's link.
 * It never calls the server; the same call again reuses the request or says what became of it.
 */
export async function requestAction(row: ConnectionRow, tool: StoredTool, args: Record<string, unknown>): Promise<ToolResult> {
  if (Buffer.byteLength(canonical(args)) > ARGUMENTS_MAX_BYTES) return answer("These inputs are too large to ask the member about. Nothing was requested.", true);
  const id = `car_${randomBytes(16).toString("hex")}`;
  try {
    // One identity for lookup and insert: a reconnect or a reapproved definition is a different action.
    const keys = createHostedCustomConnectionActionLookupKeys(canonical([row.memberId, row.id, row.generation, tool.definition.name, tool.digest, args]));
    // Sealed before the member lock, which only ever covers database work.
    const argumentsEncrypted = await sealActionSecret(row.memberId, id, "arguments", args);
    const now = new Date();
    const request = await getPrisma().$transaction((tx) => admitActionRequestTx(tx, {
      id, memberId: row.memberId, connectionId: row.id, generation: row.generation, toolName: tool.definition.name,
      digest: tool.digest, lookupKey: keys.current, lookupCandidates: keys.candidates, argumentsEncrypted, now,
    }));
    return request ? describeForModel(request, row.name)
      : answer(`The member already has ${WAITING_MAX} requests from Murph to look at. Nothing new was requested; ask them to go through those first.`, true);
  } catch {
    return answer("Couldn't ask the member right now. Try again in a minute.", true);
  }
}

export interface ActionAdmission {
  id: string; memberId: string; connectionId: string; generation: number; toolName: string; digest: string;
  lookupKey: string; lookupCandidates: string[]; argumentsEncrypted: string; now: Date;
}
/** Under the member lock: reuse a request for the same action, otherwise admit a new one while fewer than 20 wait. */
export async function admitActionRequestTx(tx: Prisma.TransactionClient, input: ActionAdmission): Promise<HostedMcpActionRequest | null> {
  await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${input.memberId} FOR UPDATE`;
  // Every read candidate is checked, so a key rotation never hides an earlier request.
  const reusable = await tx.hostedMcpActionRequest.findFirst({
    where: { memberId: input.memberId, lookupKey: { in: input.lookupCandidates }, OR: [
      { status: "waiting", expiresAt: { gt: input.now } },
      { status: { in: ["done", "declined", "unknown"] }, decidedAt: { gt: new Date(input.now.getTime() - ACTION_WINDOW_MS) } },
    ] },
    orderBy: { createdAt: "desc" },
  });
  if (reusable) return reusable;
  if (await tx.hostedMcpActionRequest.count({ where: { memberId: input.memberId, status: "waiting", expiresAt: { gt: input.now } } }) >= WAITING_MAX) return null;
  return tx.hostedMcpActionRequest.create({ data: {
    id: input.id, memberId: input.memberId, connectionId: input.connectionId, generation: input.generation,
    toolName: input.toolName, digest: input.digest, lookupKey: input.lookupKey, argumentsEncrypted: input.argumentsEncrypted,
    createdAt: input.now, expiresAt: new Date(input.now.getTime() + ACTION_WINDOW_MS),
  } });
}
function describeForModel(request: HostedMcpActionRequest, server: string): ToolResult {
  const decided = request.decidedAt ?? request.createdAt;
  if (request.status === "waiting") {
    return answer(`Not done yet. The member has to confirm this first: ${actionRequestUrl(request.id)}. Send them the link and say what it will do.`);
  }
  if (request.status === "done") return answer(`Already done. The member confirmed this at ${stamp(decided)}.`);
  if (request.status === "declined") {
    return answer(`The member said no to this at ${stamp(decided)}, so nothing was done. The same request can be made again after ${stamp(new Date(decided.getTime() + ACTION_WINDOW_MS))}.`);
  }
  // Never sent again: whether it happened is for the member to check.
  return answer(`It's not known whether this happened. The member confirmed it at ${stamp(decided)}, and ${server} may or may not have done it. Ask them to check ${server} before trying again.`);
}

/** Confirm or decline from the member's signed-in page. The POST carries only the decision; the stored request is what runs. */
export async function decideActionRequest(authority: SettingsMutation, requestId: string, decision: "confirm" | "decline"): Promise<ActionOutcome> {
  const memberId = authority.session.member.id;
  const request = ACTION_REQUEST_ID.test(requestId) ? await getPrisma().hostedMcpActionRequest.findFirst({ where: { id: requestId, memberId } }) : null;
  if (!request) throw new ConnectionError("not_found", 404);
  const now = new Date();
  const claimed = await settingsMutation(authority, (tx) => claimActionRequestTx(tx, request.id, memberId, decision === "confirm" ? "unknown" : "declined", now));
  if (!claimed) {
    const current = await getPrisma().hostedMcpActionRequest.findFirst({ where: { id: request.id, memberId } });
    if (!current) throw new ConnectionError("not_found", 404);
    return readActionOutcome(current, new Date());
  }
  return decision === "confirm" ? confirmClaimedAction(request) : { status: "declined" };
}
/** Consumes a waiting, unexpired request. A confirmation is stored as unknown before anything is sent. */
export async function claimActionRequestTx(tx: Prisma.TransactionClient, id: string, memberId: string, status: "unknown" | "declined", now: Date): Promise<boolean> {
  const claimed = await tx.hostedMcpActionRequest.updateMany({
    where: { id, memberId, status: "waiting", expiresAt: { gt: now } }, data: { status, decidedAt: now },
  });
  return claimed.count === 1;
}

class ActionStop extends Error {
  constructor(readonly reason: ActionFailure) { super(reason); }
}
/** The connection as it is now, if the request can still run exactly as the member saw it. */
async function currentConnection(request: HostedMcpActionRequest): Promise<ConnectionRow> {
  const row = await readConnection(request.memberId, request.connectionId);
  if (row.status === "needs_sign_in") throw new ActionStop("signed_out");
  if (row.status !== "on") throw new ActionStop("off");
  const tool = approvedTool(storedToolsSchema.parse(row.tools), request.toolName);
  if (row.generation !== request.generation || tool?.digest !== request.digest) throw new ActionStop("changed");
  return row;
}
function failureReason(error: unknown): ActionFailure {
  if (error instanceof ActionStop) return error.reason;
  if (!(error instanceof ConnectionError)) return "unreachable";
  if (error.code === "needs_sign_in") return "signed_out";
  if (error.code === "refused_by_service") return "refused";
  return error.code === "conflict" || error.code === "not_found" ? "changed" : "unreachable";
}
/** Runs a claimed request once. Nothing after its tool call leaves Web proves it didn't happen, so only earlier failures are failed. */
async function confirmClaimedAction(request: HostedMcpActionRequest): Promise<ActionOutcome> {
  const write: ConnectionWrite = { sent: false };
  let outcome: ActionOutcome;
  try {
    outcome = await sendClaimedAction(request, write);
  } catch (error) {
    outcome = write.sent ? { status: "unknown" } : { status: "failed", reason: failureReason(error) };
  }
  return settleActionRequest(request, outcome);
}
async function sendClaimedAction(request: HostedMcpActionRequest, write: ConnectionWrite): Promise<ActionOutcome> {
  const args = await openActionSecret(request.memberId, request.id, "arguments", request.argumentsEncrypted) as Record<string, unknown>;
  const connection = await currentConnection(request);
  const result = await withConnectionClient(connection, async (client, options) => {
    // Sign-in and setup take time in which the member can turn it off or reconnect, so check again right before it leaves.
    await currentConnection(request);
    return await client.callTool({ name: request.toolName, arguments: args }, options);
  }, undefined, write);
  await markConnectionUsed(connection);
  return toolOutcome(result);
}
function toolOutcome(result: unknown): ActionOutcome {
  if (!isCallToolResult(result) || Buffer.byteLength(JSON.stringify(result)) > RESULT_MAX_BYTES) return { status: "unknown" };
  const text = result.content.flatMap((item) => item.type === "text" ? [item.text] : []).join("\n").trim();
  const shown = text ? { text: [...text].slice(0, RESULT_TEXT_MAX).join("") } : {};
  // A tool can report an error after doing part of its work, so only a clean result counts as done.
  return { status: result.isError ? "unknown" : "done", ...shown };
}
/** Refines the claim. When that fails the request stays unknown, which is then what the member and Murph see. */
async function settleActionRequest(request: HostedMcpActionRequest, outcome: ActionOutcome): Promise<ActionOutcome> {
  const stored = "reason" in outcome ? { reason: outcome.reason } : "text" in outcome && outcome.text ? { text: outcome.text } : null;
  if (outcome.status === "unknown" && !stored) return outcome;
  try {
    const resultEncrypted = stored ? await sealActionSecret(request.memberId, request.id, "result", stored) : null;
    const saved = await getPrisma().hostedMcpActionRequest.updateMany({
      where: { id: request.id, memberId: request.memberId, status: "unknown" }, data: { status: outcome.status, resultEncrypted },
    });
    return saved.count === 1 ? outcome : { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

async function readActionOutcome(request: HostedMcpActionRequest, now: Date): Promise<ActionOutcome> {
  if (request.status === "waiting") return { status: request.expiresAt > now ? "waiting" : "expired" };
  if (request.status === "declined") return { status: "declined" };
  const stored = request.resultEncrypted
    ? storedResultSchema.parse(await openActionSecret(request.memberId, request.id, "result", request.resultEncrypted)) : {};
  if (request.status === "failed") return { status: "failed", reason: stored.reason ?? "unreachable" };
  return { status: request.status === "done" ? "done" : "unknown", ...(stored.text ? { text: stored.text } : {}) };
}

export interface ActionRequestView {
  askedAt: string;
  host: string;
  id: string;
  /** The stored inputs, opened only while the member can still act on them. */
  inputs?: Record<string, unknown>;
  outcome: ActionOutcome;
  server: string;
  title: string;
}
/** The confirm page's view of one of the member's requests; another member's or a malformed id reads as missing. */
export async function readActionRequestView(memberId: string, requestId: string): Promise<ActionRequestView | null> {
  if (!ACTION_REQUEST_ID.test(requestId)) return null;
  const request = await getPrisma().hostedMcpActionRequest.findFirst({
    where: { id: requestId, memberId }, include: { connection: { select: { name: true, serverUrl: true, tools: true } } },
  });
  if (!request) return null;
  const outcome = await readActionOutcome(request, new Date());
  const tool = storedToolsSchema.parse(request.connection.tools).find((item) => item.definition.name === request.toolName);
  const inputs = outcome.status === "waiting"
    ? await openActionSecret(memberId, request.id, "arguments", request.argumentsEncrypted) as Record<string, unknown> : undefined;
  return {
    askedAt: request.createdAt.toISOString(), host: new URL(request.connection.serverUrl).host, id: request.id,
    ...(inputs ? { inputs } : {}), outcome, server: request.connection.name, title: tool?.definition.title ?? request.toolName,
  };
}

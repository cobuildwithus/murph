import "server-only";

import { randomBytes } from "node:crypto";
import type { JsonSchemaType } from "@modelcontextprotocol/client";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/client/validators/cf-worker";
import * as z from "@murphai/contracts/zod-runtime";
import type { HostedMcpActionRequest, Prisma } from "@prisma/client";
import { createHostedCustomConnectionActionLookupKeys } from "../hosted-onboarding/contact-privacy";
import { getPrisma } from "../prisma";
import { connectionChangesAllowed } from "./access";
import { canonical, storedToolsSchema, type StoredTool, type ToolDefinition } from "./catalog";
import { WEB_ORIGIN } from "./oauth";
import { openActionSecret, sealActionSecret } from "./secrets";
import type { ConnectionRow } from "./store";

/** A waiting request is open for an hour; a decided one answers the same call for an hour after its decision. */
export const ACTION_WINDOW_MS = 3_600_000;
export const WAITING_MAX = 20;
const ARGUMENTS_MAX_BYTES = 16_384;
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
/** One identity for lookup and insert: a reconnect or a reapproved definition is a different action. */
export function actionLookupKeys(input: { memberId: string; connectionId: string; generation: number; toolName: string; digest: string }, args: unknown) {
  return createHostedCustomConnectionActionLookupKeys(canonical([input.memberId, input.connectionId, input.generation, input.toolName, input.digest, args]));
}

const JSON_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Only the declared names, types and required inputs of a server's schema: no patterns or references to evaluate. */
function typedShape(schema: unknown, depth: number): Record<string, unknown> {
  if (!isRecord(schema) || depth > 4) return {};
  const types = [schema.type].flat().filter((type) => typeof type === "string" && JSON_TYPES.has(type));
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  return {
    ...(types.length > 0 ? { type: types } : {}),
    ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([name, item]) => [name, typedShape(item, depth + 1)])) } : {}),
    ...(Array.isArray(schema.required) ? { required: schema.required.filter((name) => typeof name === "string") } : {}),
    ...(isRecord(schema.items) ? { items: typedShape(schema.items, depth + 1) } : {}),
  };
}
const validator = new CfWorkerJsonSchemaValidator({ shortcircuit: true });
/** What the member will be shown must be what the tool declares: no undeclared inputs and no mismatched types. */
function argumentsProblem(definition: ToolDefinition, args: Record<string, unknown>): string | undefined {
  const shape: Record<string, unknown> = { ...typedShape(definition.inputSchema, 0), additionalProperties: false };
  const result = validator.getValidator(shape as JsonSchemaType)(args);
  return result.valid ? undefined : result.errorMessage;
}

/**
 * The gateway's answer to an approved write: it records exactly what Murph asked for and returns the member's link.
 * It never calls the server; the same call again reuses the request or says what became of it.
 */
export async function requestAction(row: ConnectionRow, tool: StoredTool, args: Record<string, unknown>): Promise<ToolResult> {
  if (!await connectionChangesAllowed(row.memberId)) {
    return answer("Not done. This member's account can't approve changes yet: that needs an account set up with their phone or Telegram. Nothing was requested.", true);
  }
  if (Buffer.byteLength(canonical(args)) > ARGUMENTS_MAX_BYTES) return answer("These inputs are too large to ask the member about. Nothing was requested.", true);
  const problem = argumentsProblem(tool.definition, args);
  if (problem) return answer(`These inputs don't match ${tool.definition.name}'s input schema (${problem}). Nothing was requested.`, true);
  const id = `car_${randomBytes(16).toString("hex")}`;
  try {
    const keys = actionLookupKeys({ memberId: row.memberId, connectionId: row.id, generation: row.generation, toolName: tool.definition.name, digest: tool.digest }, args);
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

export async function readActionOutcome(request: HostedMcpActionRequest, now: Date): Promise<ActionOutcome> {
  if (request.status === "waiting") return { status: request.expiresAt > now ? "waiting" : "expired" };
  if (request.status === "declined") return { status: "declined" };
  const stored = request.resultEncrypted
    ? storedResultSchema.parse(await openActionSecret(request.memberId, request.id, "result", request.resultEncrypted)) : {};
  if (request.status === "failed") return { status: "failed", reason: stored.reason ?? "unreachable" };
  return { status: request.status === "done" ? "done" : "unknown", ...(stored.text ? { text: stored.text } : {}) };
}

export interface ActionRequestView {
  askedAt: string;
  /** When the member last confirmed this same change, if that request may already have run it. */
  confirmedBefore?: string;
  host: string;
  id: string;
  /** The stored inputs in the tool's own declared order, opened only while the member can still act on them. */
  inputs?: { name: string; value: unknown }[];
  outcome: ActionOutcome;
  server: string;
  title: string;
}
function orderedInputs(args: Record<string, unknown>, definition: ToolDefinition | undefined) {
  const declared = Object.keys(isRecord(definition?.inputSchema.properties) ? definition.inputSchema.properties : {});
  const names = [...declared.filter((name) => Object.hasOwn(args, name)), ...Object.keys(args).filter((name) => !declared.includes(name))];
  return names.map((name) => ({ name, value: args[name] }));
}
/** The confirm page's view of one of the member's requests; another member's or a malformed id reads as missing. */
export async function readActionRequestView(memberId: string, requestId: string): Promise<ActionRequestView | null> {
  if (!ACTION_REQUEST_ID.test(requestId)) return null;
  const request = await getPrisma().hostedMcpActionRequest.findFirst({
    where: { id: requestId, memberId }, include: { connection: { select: { name: true, serverUrl: true, tools: true } } },
  });
  if (!request) return null;
  const outcome = await readActionOutcome(request, new Date());
  const tools = storedToolsSchema.parse(request.connection.tools).filter((item) => item.definition.name === request.toolName);
  const definition = (tools.find((item) => item.digest === request.digest) ?? tools[0])?.definition;
  const view = { askedAt: request.createdAt.toISOString(), host: new URL(request.connection.serverUrl).host, id: request.id,
    outcome, server: request.connection.name, title: definition?.title ?? request.toolName };
  if (outcome.status !== "waiting") return view;
  const args = await openActionSecret(memberId, request.id, "arguments", request.argumentsEncrypted) as Record<string, unknown>;
  // The same change confirmed before may have run already, so the member hears about it before confirming again.
  const earlier = await getPrisma().hostedMcpActionRequest.findFirst({
    where: { memberId, id: { not: request.id }, lookupKey: { in: actionLookupKeys(request, args).candidates }, status: { in: ["done", "unknown"] } },
    orderBy: { decidedAt: "desc" }, select: { decidedAt: true },
  });
  return { ...view, inputs: orderedInputs(args, definition), ...(earlier?.decidedAt ? { confirmedBefore: earlier.decidedAt.toISOString() } : {}) };
}

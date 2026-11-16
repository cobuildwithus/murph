import "server-only";

import { createHash } from "node:crypto";
import { isCallToolResult } from "@modelcontextprotocol/client";
import type { HostedMcpActionRequest, Prisma } from "@prisma/client";
import { assertHostedAppSessionCurrentTx } from "../hosted-onboarding/app-session";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberRow } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { consumeSensitiveActionChallengeTx, createSensitiveActionChallengeMaterial, verifySensitiveActionChallenge } from "../sensitive-actions/server";
import type { SensitiveActionChallengeResponse } from "../sensitive-actions/shared";
import { ACTION_REQUEST_ID, WAITING_MAX, readActionOutcome, type ActionFailure, type ActionOutcome } from "./action-requests";
import { approvedTool, storedToolsSchema } from "./catalog";
import { ConnectionError } from "./errors";
import { sealActionSecret, openActionSecret } from "./secrets";
import type { SettingsMutation } from "./service";
import { markConnectionUsed, readConnection, type ConnectionRow } from "./store";
import { withConnectionClient, type ConnectionWrite } from "./upstream";

const RESULT_MAX_BYTES = 262_144;
const RESULT_TEXT_MAX = 2_000;
const CHALLENGE_MS = 15 * 60_000;
export const ACTION_CONFIRM_KIND = "custom-connection.action.confirm";
const ACTION_CONFIRM_BINDING_VERSION = "murph-custom-connection-action-confirm-v1";

export type ActionDecision = { decision: "confirm"; authorization?: unknown } | { decision: "decline" };
type BoundRequest = Pick<HostedMcpActionRequest, "id" | "memberId" | "connectionId" | "generation" | "toolName" | "digest" | "lookupKey">;

/** What the member's passkey signs: this browser session and exactly this request, as stored. */
export function actionConfirmBinding(request: BoundRequest, sessionId: string): string {
  return createHash("sha256").update([
    ACTION_CONFIRM_BINDING_VERSION, ACTION_CONFIRM_KIND, request.memberId, sessionId, request.id,
    request.connectionId, String(request.generation), request.toolName, request.digest, request.lookupKey,
  ].join("\n")).digest("hex");
}
async function readMemberRequest(memberId: string, requestId: string): Promise<HostedMcpActionRequest> {
  const request = ACTION_REQUEST_ID.test(requestId) ? await getPrisma().hostedMcpActionRequest.findFirst({ where: { id: requestId, memberId } }) : null;
  if (!request) throw new ConnectionError("not_found", 404);
  return request;
}
const waiting = (request: HostedMcpActionRequest, now: Date) => request.status === "waiting" && request.expiresAt > now;

/** A one-use passkey challenge for confirming one waiting request, issued under the full Settings mutation contract. */
export async function issueActionConfirmChallenge(authority: SettingsMutation, requestId: string): Promise<SensitiveActionChallengeResponse> {
  const memberId = authority.session.member.id;
  const request = await readMemberRequest(memberId, requestId);
  const now = new Date();
  if (!waiting(request, now)) throw new ConnectionError("request_closed", 409);
  const bindingHash = actionConfirmBinding(request, authority.session.sessionId);
  // A challenge never outlives the request it confirms.
  const expiresAt = new Date(Math.min(now.getTime() + CHALLENGE_MS, request.expiresAt.getTime()));
  const challenge = createSensitiveActionChallengeMaterial({ bindingHash, expiresAt, kind: ACTION_CONFIRM_KIND });
  await lockedSettingsMutation(authority, (tx) => tx.hostedSensitiveActionChallenge.create({
    data: { bindingHash, createdAt: now, expiresAt, kind: ACTION_CONFIRM_KIND, memberId, tokenHash: challenge.tokenHash },
  }));
  return challenge.response;
}
/** For the passkey prompt: whether a challenge was issued to this session for one of the member's waiting requests. */
export async function actionConfirmChallengeIsCurrent(input: { bindingHash: string; memberId: string; sessionId: string }): Promise<boolean> {
  const requests = await getPrisma().hostedMcpActionRequest.findMany({
    where: { memberId: input.memberId, status: "waiting", expiresAt: { gt: new Date() } }, take: WAITING_MAX,
    select: { id: true, memberId: true, connectionId: true, generation: true, toolName: true, digest: true, lookupKey: true },
  });
  return requests.some((request) => actionConfirmBinding(request, input.sessionId) === input.bindingHash);
}

/** Member, then session, then the one-use challenge, in the order action approvals take them. */
async function lockedSettingsMutation<T>(authority: SettingsMutation, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const memberId = authority.session.member.id;
  return getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, memberId);
    await assertHostedAppSessionCurrentTx({ memberId, sessionId: authority.session.sessionId, authProof: authority.session.authProof, prisma: tx, request: authority.request });
    return operation(tx);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

/**
 * Confirm or decline from the member's signed-in page. A session alone never runs a change: confirming needs the
 * member's approval passkey over this exact request, consumed in the transaction that claims it. Declining doesn't.
 */
export async function decideActionRequest(authority: SettingsMutation, requestId: string, input: ActionDecision): Promise<ActionOutcome> {
  const memberId = authority.session.member.id;
  const request = await readMemberRequest(memberId, requestId);
  const now = new Date();
  if (!waiting(request, now)) return readActionOutcome(request, now);
  const proof = input.decision === "confirm" ? await verifySensitiveActionChallenge({
    authorization: input.authorization, bindingHash: actionConfirmBinding(request, authority.session.sessionId),
    kind: ACTION_CONFIRM_KIND, memberId, now, prisma: getPrisma(),
  }) : null;
  const claimed = await lockedSettingsMutation(authority, async (tx) => {
    if (proof) await consumeSensitiveActionChallengeTx({ challenge: proof, prisma: tx });
    return claimActionRequestTx(tx, request.id, memberId, proof ? "unknown" : "declined", new Date());
  });
  if (!claimed) return readActionOutcome(await readMemberRequest(memberId, request.id), new Date());
  return proof ? confirmClaimedAction(request) : { status: "declined" };
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

import "server-only";

import { openHostedUserSecureBoxString, sealHostedUserSecureBoxString } from "../hosted-crypto/secure-box";

type Binding = { userId: string; scope: string; aad: { table: string; rowId: string; field: string; purpose: string } };
function binding(memberId: string, id: string, generation: number, field: string): Binding {
  return {
    userId: memberId, scope: `custom-connection:${id}:${generation}`,
    aad: { table: "hosted_mcp_connection", rowId: id, field, purpose: "custom-connection" },
  };
}
/** An action request's inputs and result open only for that request and field. */
function actionBinding(memberId: string, requestId: string, field: "arguments" | "result"): Binding {
  return {
    userId: memberId, scope: `custom-connection-action:${requestId}`,
    aad: { table: "hosted_mcp_action_request", rowId: requestId, field, purpose: "custom-connection-action" },
  };
}
async function seal(bound: Binding, value: unknown): Promise<string> {
  const sealed = await sealHostedUserSecureBoxString({ ...bound, lane: "hosted-member-private-field", value: JSON.stringify(value) });
  if (!sealed) throw new Error("Connection encryption failed");
  return sealed;
}
async function open(bound: Binding, value: string): Promise<unknown> {
  const opened = await openHostedUserSecureBoxString({ ...bound, lane: "hosted-member-private-field", value });
  if (!opened) throw new Error("Connection decryption failed");
  return JSON.parse(opened);
}
export async function sealConnectionSecret(memberId: string, id: string, generation: number, field: string, value: unknown): Promise<string> {
  return seal(binding(memberId, id, generation, field), value);
}
export async function openConnectionSecret(memberId: string, id: string, generation: number, field: string, value: string): Promise<unknown> {
  return open(binding(memberId, id, generation, field), value);
}
export async function sealActionSecret(memberId: string, requestId: string, field: "arguments" | "result", value: unknown): Promise<string> {
  return seal(actionBinding(memberId, requestId, field), value);
}
export async function openActionSecret(memberId: string, requestId: string, field: "arguments" | "result", value: string): Promise<unknown> {
  return open(actionBinding(memberId, requestId, field), value);
}

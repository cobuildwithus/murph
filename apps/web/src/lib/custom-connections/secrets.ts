import "server-only";

import { openHostedUserSecureBoxString, sealHostedUserSecureBoxString } from "../hosted-crypto/secure-box";

function binding(memberId: string, id: string, generation: number, field: string) {
  return {
    userId: memberId, lane: "hosted-member-private-field" as const,
    scope: `custom-connection:${id}:${generation}`,
    aad: { table: "hosted_mcp_connection", rowId: id, field, purpose: "custom-connection" },
  };
}
export async function sealConnectionSecret(memberId: string, id: string, generation: number, field: string, value: unknown): Promise<string> {
  const sealed = await sealHostedUserSecureBoxString({ ...binding(memberId, id, generation, field), value: JSON.stringify(value) });
  if (!sealed) throw new Error("Connection encryption failed");
  return sealed;
}
export async function openConnectionSecret(memberId: string, id: string, generation: number, field: string, value: string): Promise<unknown> {
  const opened = await openHostedUserSecureBoxString({ ...binding(memberId, id, generation, field), value });
  if (!opened) throw new Error("Connection decryption failed");
  return JSON.parse(opened);
}

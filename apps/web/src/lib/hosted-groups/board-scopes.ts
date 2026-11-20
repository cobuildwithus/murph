import { createHash } from "node:crypto";
import { HOSTED_VAULT_SHARE_BOARD_PROJECTION_KINDS, hostedVaultShareProjectionKindToScope } from "@murphai/hosted-execution/vault-share";

/** The app manages only these permissions; all other group choices survive saves. */
export const HOSTED_GROUP_BOARD_SCOPES = HOSTED_VAULT_SHARE_BOARD_PROJECTION_KINDS.map(hostedVaultShareProjectionKindToScope);

/** Rows arrive in ID order. A regrant rotates the row ID. Revoked generations distinguish off → on → off. */
export function boardSharingRevision(memberId: string, runtimeMemberId: string, rows: readonly { id: string; status: string }[]) {
  const generations = rows.map(row => [row.id, row.status]);
  return createHash("sha256").update(JSON.stringify([runtimeMemberId, memberId, generations])).digest("hex");
}

import { HOSTED_VAULT_SHARE_BOARD_PROJECTION_KINDS, hostedVaultShareProjectionKindToScope } from "@murphai/hosted-execution/vault-share";

/** The app manages only these permissions; all other group choices survive saves. */
export const HOSTED_GROUP_BOARD_SCOPES = HOSTED_VAULT_SHARE_BOARD_PROJECTION_KINDS.map(hostedVaultShareProjectionKindToScope);

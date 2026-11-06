import { hostedVaultShareProjectionKindToScope } from "@murphai/hosted-execution/vault-share";

/** The app manages only these permissions; all other group choices survive saves. */
export const HOSTED_GROUP_BOARD_SCOPES = ([
  "resting-heart-rate-days.v0", "sleep-duration-days.v0", "steps-days.v0", "vo2-max-days.v0",
] as const).map(hostedVaultShareProjectionKindToScope);

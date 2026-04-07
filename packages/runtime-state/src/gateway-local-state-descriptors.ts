import {
  defineLocalStateFileDescriptor,
  type VaultLocalStatePathDescriptor,
} from "./local-state-descriptor-helpers.ts";

const GATEWAY_LOCAL_OWNER = "gateway-local";

export const gatewayLocalStateDescriptors: readonly VaultLocalStatePathDescriptor[] = [
  defineLocalStateFileDescriptor({
    classification: "projection",
    description:
      "Gateway-local owns the rebuildable local gateway projection store derived from canonical vault evidence plus local gateway runtime inputs.",
    owner: GATEWAY_LOCAL_OWNER,
    portability: "machine_local",
    rebuildable: true,
    relativePath: ".runtime/projections/gateway.sqlite",
  }),
] as const;

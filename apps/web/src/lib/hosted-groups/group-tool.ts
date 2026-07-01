import "server-only";

import type {
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { readHostedGroupByRuntimeMemberId } from "./group-store";

export async function handleHostedRuntimeGroupTool(input: {
  memberId: string;
  request: HostedRuntimeGroupToolRequest;
}): Promise<HostedRuntimeGroupToolResponse> {
  if (!await hasHostedRuntimeActiveAccess(input.memberId)) {
    return {
      action: "read_current",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    };
  }

  const group = await readHostedGroupByRuntimeMemberId({
    runtimeMemberId: input.memberId,
  });

  return {
    action: "read_current",
    result: group
      ? { status: "ok", group }
      : { status: "none", group: null },
  };
}

import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { parseHostedRuntimeIssueRecordResponse } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { HOSTED_RUNTIME_ISSUE_RECORD_PATH } from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeIssueExportPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["issueExportPort"]> {
  return {
    async recordIssues(issues) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          issues,
        },
        boundUserId: input.boundUserId,
        description: "Hosted assistant runtime issue export",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_ISSUE_RECORD_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeIssueRecordResponse(payload);
      } catch (error) {
        throw new Error("Hosted assistant runtime issue export returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}

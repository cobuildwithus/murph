import { describe, expect, it, vi } from "vitest";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import { consumeHostedActionApproval, readHostedActionApprovalObservation, requestHostedActionApproval } from "@/src/lib/action-approvals";
import { createJsonErrorResponse } from "@/src/lib/http";

const request = {
  actionFingerprint: "b".repeat(64), actionId: `vault-file-send:${"a".repeat(64)}`,
  actionKind: "vault.file.send.v1", presentation: { body: "Send a file.", title: "Send?" }, returnContactKind: "text",
};
const consume = { request, approvalGeneration: "b".repeat(64), consumerId: "synthetic-consumer" };

describe.each([
  ["request", requestHostedActionApproval, request],
  ["read", readHostedActionApprovalObservation, request],
  ["consume", consumeHostedActionApproval, consume],
] as const)("action approval %s boundary", (_name, run, valid) => {
  it.each([false, true])("distinguishes caller shape from database validation failures: %s", async dependencyFails => {
    const failure = new ContractValidationError("Synthetic stored record failure.");
    const read = vi.fn(async () => { throw failure; });
    const prisma = { hostedSensitiveActionChallenge: { upsert: read, findFirst: read } };
    const error = await run({ memberId: "synthetic-member", prisma: prisma as never, request: dependencyFails ? valid : {} }).catch(error => error);
    const response = createJsonErrorResponse(error, { internalMessage: "Approval failed.", logMessage: "Approval failed." });
    expect(response.status).toBe(dependencyFails ? 500 : 400);
    expect(await response.json()).toEqual({ error: dependencyFails
      ? { code: "INTERNAL_ERROR", message: "Internal error." }
      : { code: "INVALID_REQUEST", message: "Invalid request." } });
    expect(read).toHaveBeenCalledTimes(dependencyFails ? 1 : 0);
    if (dependencyFails) expect(error).toBe(failure);
  });
});

import { describe, expect, it } from "vitest";

import {
  HOSTED_ASSISTANT_CONFIGURATION_ACTION_KIND,
  buildHostedAssistantConfigurationApprovalConsumerId,
  buildHostedAssistantConfigurationApprovalRequest,
} from "../src/assistant-configuration-approval.ts";
import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
} from "../src/assistant-model.ts";
import {
  parseHostedRuntimeAssistantConfigurationControlRequest,
  parseHostedRuntimeAssistantConfigurationToolRequest,
} from "../src/parsers.ts";

const BASE_INPUT = {
  changes: {
    model: HOSTED_ASSISTANT_LUNA_MODEL,
    reasoningEffort: "low" as const,
  },
  returnContactKind: "text" as const,
  target: {
    model: HOSTED_ASSISTANT_LUNA_MODEL,
    reasoningEffort: "low" as const,
  },
};

describe("hosted assistant configuration approvals", () => {
  it("binds stable action identity and fingerprint to the requested changes and resolved target", () => {
    const request = buildHostedAssistantConfigurationApprovalRequest(BASE_INPUT);

    expect(request).toEqual({
      actionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      actionId: expect.stringMatching(
        /^assistant-configuration-update:[0-9a-f]{64}$/u,
      ),
      actionKind: HOSTED_ASSISTANT_CONFIGURATION_ACTION_KIND,
      presentation: {
        body: "Set Murph's next-turn model settings to Luna with low reasoning. This approval applies only to this exact change and resolved setting.",
        title: "Change Murph's model settings?",
      },
      returnContactKind: "text",
    });
    expect(buildHostedAssistantConfigurationApprovalRequest({
      changes: BASE_INPUT.changes,
      returnContactKind: "text",
      target: {
        model: HOSTED_ASSISTANT_LUNA_MODEL,
        reasoningEffort: "low",
      },
    })).toEqual(request);

    for (const target of [
      { model: HOSTED_ASSISTANT_TERRA_MODEL, reasoningEffort: "low" as const },
      { model: HOSTED_ASSISTANT_SOL_MODEL, reasoningEffort: "low" as const },
      { model: HOSTED_ASSISTANT_LUNA_MODEL, reasoningEffort: "medium" as const },
      { model: HOSTED_ASSISTANT_LUNA_MODEL, reasoningEffort: "xhigh" as const },
    ]) {
      const changed = buildHostedAssistantConfigurationApprovalRequest({
        changes: {
          model: target.model,
          reasoningEffort: target.reasoningEffort,
        },
        returnContactKind: "text",
        target,
      });
      expect(changed.actionId).not.toBe(request.actionId);
      expect(changed.actionFingerprint).not.toBe(request.actionFingerprint);
    }
  });

  it("distinguishes the requested field mask for one resolved target", () => {
    const target = BASE_INPUT.target;
    const modelOnly = buildHostedAssistantConfigurationApprovalRequest({
      changes: { model: target.model },
      returnContactKind: "text",
      target,
    });
    const reasoningOnly = buildHostedAssistantConfigurationApprovalRequest({
      changes: { reasoningEffort: target.reasoningEffort },
      returnContactKind: "text",
      target,
    });

    expect(modelOnly.actionId).not.toBe(reasoningOnly.actionId);
    expect(modelOnly.presentation.body).toBe(
      "Set Murph's next-turn model to Luna. Reasoning stays low. This approval applies only to this exact change and resolved setting.",
    );
    expect(reasoningOnly.presentation.body).toBe(
      "Set Murph's next-turn reasoning to low. Model stays Luna. This approval applies only to this exact change and resolved setting.",
    );
  });

  it("binds action identity and fingerprint to the return contact", () => {
    const returnContactKinds = [null, "email", "telegram", "text"] as const;
    const requests = returnContactKinds.map(
      (returnContactKind) => buildHostedAssistantConfigurationApprovalRequest({
        changes: BASE_INPUT.changes,
        returnContactKind,
        target: BASE_INPUT.target,
      }),
    );

    expect(new Set(requests.map((request) => request.actionId))).toHaveLength(4);
    expect(new Set(requests.map((request) => request.actionFingerprint)))
      .toHaveLength(4);
    expect(requests.map((request) => request.returnContactKind)).toEqual([
      null,
      "email",
      "telegram",
      "text",
    ]);
  });

  it("derives a deterministic same-action approval consumer", () => {
    const request = buildHostedAssistantConfigurationApprovalRequest(BASE_INPUT);
    const repeated = buildHostedAssistantConfigurationApprovalRequest(BASE_INPUT);
    const changed = buildHostedAssistantConfigurationApprovalRequest({
      ...BASE_INPUT,
      target: {
        model: HOSTED_ASSISTANT_LUNA_MODEL,
        reasoningEffort: "high",
      },
    });

    expect(buildHostedAssistantConfigurationApprovalConsumerId(request))
      .toBe(buildHostedAssistantConfigurationApprovalConsumerId(repeated));
    expect(buildHostedAssistantConfigurationApprovalConsumerId(request))
      .toMatch(/^assistant-configuration-update:[0-9a-f]{64}$/u);
    expect(buildHostedAssistantConfigurationApprovalConsumerId(request))
      .not.toBe(buildHostedAssistantConfigurationApprovalConsumerId(changed));
  });

  it("strictly parses the internal field mask, resolved target, and approval proof", () => {
    const request = buildHostedAssistantConfigurationApprovalRequest(BASE_INPUT);
    const approval = {
      approvalGeneration: "a".repeat(64),
      consumerId: buildHostedAssistantConfigurationApprovalConsumerId(request),
      request,
    };

    expect(parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "read",
    })).toEqual({ action: "read" });
    expect(parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      approval,
      model: BASE_INPUT.target.model,
      reasoningEffort: BASE_INPUT.target.reasoningEffort,
      target: BASE_INPUT.target,
    })).toEqual({
      action: "update",
      approval,
      model: BASE_INPUT.target.model,
      reasoningEffort: BASE_INPUT.target.reasoningEffort,
      target: BASE_INPUT.target,
    });

    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      model: BASE_INPUT.target.model,
      reasoningEffort: BASE_INPUT.target.reasoningEffort,
      target: BASE_INPUT.target,
    })).toThrow(/approval/u);
    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      approval: {
        ...approval,
        proof: "unsupported",
      },
      model: BASE_INPUT.target.model,
      reasoningEffort: BASE_INPUT.target.reasoningEffort,
      target: BASE_INPUT.target,
    })).toThrow(/unsupported fields/u);
    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      approval,
      approvalGeneration: approval.approvalGeneration,
      model: BASE_INPUT.target.model,
      reasoningEffort: BASE_INPUT.target.reasoningEffort,
      target: BASE_INPUT.target,
    })).toThrow(/approvalGeneration is not allowed/u);
    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      approval: {
        ...approval,
        approvalGeneration: "not-a-proof",
      },
      model: BASE_INPUT.target.model,
      reasoningEffort: BASE_INPUT.target.reasoningEffort,
      target: BASE_INPUT.target,
    })).toThrow(/lowercase SHA-256/u);
    expect(() => parseHostedRuntimeAssistantConfigurationControlRequest({
      action: "update",
      approval,
      model: BASE_INPUT.target.model,
    })).toThrow(/target/u);
  });

  it("preserves the separate model-facing partial update contract", () => {
    expect(parseHostedRuntimeAssistantConfigurationToolRequest({
      action: "update",
      model: HOSTED_ASSISTANT_LUNA_MODEL,
    })).toEqual({
      action: "update",
      model: HOSTED_ASSISTANT_LUNA_MODEL,
    });
    expect(parseHostedRuntimeAssistantConfigurationToolRequest({
      action: "update",
      reasoningEffort: "high",
    })).toEqual({
      action: "update",
      reasoningEffort: "high",
    });
    expect(() => parseHostedRuntimeAssistantConfigurationToolRequest({
      action: "update",
      approval: {},
      model: HOSTED_ASSISTANT_LUNA_MODEL,
    })).toThrow(/approval is not allowed/u);
  });
});

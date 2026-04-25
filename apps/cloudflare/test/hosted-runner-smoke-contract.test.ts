import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  parseHostedRunnerSmokeInput,
  parseHostedRunnerSmokeResult,
} from "../src/hosted-runner-smoke-contract.js";

const validHostedRunnerSmokeResult = {
  childCwd: "/tmp/hosted-runner-smoke-launch-123",
  healthCommonsCatalogHash: "sha256:catalog",
  healthCommonsCliProtocolListBytes: 768,
  healthCommonsCliSearchBytes: 512,
  healthCommonsFinnishDrySaunaTitle: "Finnish Dry Sauna",
  healthCommonsRuntimeProtocolHitKeys: [
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  ],
  healthCommonsRuntimeSearchHitKeys: [
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  ],
  murphBin: "/app/node_modules/.bin/murph",
  normalizedTranscriptMatchesExpectedSnippet: true,
  normalizedTranscriptProviderId: "whisper.cpp",
  normalizedTranscriptSha256: "normalized-hash",
  operatorHomeRoot: "/tmp/hosted-runner-smoke/home",
  reportedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
  schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  vaultCliBin: "/app/node_modules/.bin/vault-cli",
  vaultRoot: "/tmp/hosted-runner-smoke/vault",
  vaultShowBytes: 128,
  wavTranscriptMatchesExpectedSnippet: true,
  wavTranscriptProviderId: "whisper.cpp",
  wavTranscriptSha256: "wav-hash",
} as const;

describe("parseHostedRunnerSmokeInput", () => {
  it("accepts the local smoke payload shape", () => {
    expect(parseHostedRunnerSmokeInput({
      bundle: "bundle-base64",
      expectedTranscriptSnippet: "hello",
      expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    })).toEqual({
      bundle: "bundle-base64",
      expectedTranscriptSnippet: "hello",
      expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    });
  });

  it("rejects empty required strings", () => {
    expect(() => parseHostedRunnerSmokeInput({
      bundle: "  ",
      expectedTranscriptSnippet: null,
      expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    })).toThrow("Hosted runner smoke input.bundle must be a non-empty string.");
  });
});

describe("parseHostedRunnerSmokeResult", () => {
  it("accepts the in-image smoke result shape", () => {
    expect(parseHostedRunnerSmokeResult(validHostedRunnerSmokeResult)).toMatchObject({
      murphBin: "/app/node_modules/.bin/murph",
      normalizedTranscriptSha256: "normalized-hash",
      schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
      healthCommonsCatalogHash: "sha256:catalog",
      healthCommonsCliSearchBytes: 512,
      healthCommonsFinnishDrySaunaTitle: "Finnish Dry Sauna",
      reportedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      healthCommonsRuntimeSearchHitKeys: [
        "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      ],
      vaultShowBytes: 128,
      wavTranscriptProviderId: "whisper.cpp",
    });
  });

  it("rejects missing or empty Health Commons proof fields", () => {
    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      healthCommonsCatalogHash: " ",
    })).toThrow(
      "Hosted runner smoke result.healthCommonsCatalogHash must be a non-empty string.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      healthCommonsRuntimeSearchHitKeys: [],
    })).toThrow(
      "Hosted runner smoke result.healthCommonsRuntimeSearchHitKeys must be a non-empty array.",
    );
  });

  it("rejects unexpected schemas", () => {
    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      schema: "bad-schema",
    })).toThrow(
      `Hosted runner smoke result.schema must be ${HOSTED_RUNNER_SMOKE_RESULT_SCHEMA}.`,
    );
  });
});

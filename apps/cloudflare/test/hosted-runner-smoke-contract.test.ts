import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  parseHostedRunnerSmokeInput,
  parseHostedRunnerSmokeResult,
} from "../src/hosted-runner-smoke-contract.js";

const validHostedRunnerSmokeResult = {
  childCwdIsIsolated: true,
  codexAppServerHelpBytes: 2048,
  codexCommandDiscovered: true,
  codexHostedConfigShellEnvironmentPolicyAllowlisted: true,
  codexHostedShellMurphPathBytes: 1536,
  codexHostedShellPythonVersion: "Python 3.11.2",
  codexHostedShellVaultCliLlmsBytes: 4096,
  codexVersion: "codex-cli 0.125.0",
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
  murphCommandDiscovered: true,
  normalizedTranscriptMatchesExpectedSnippet: true,
  normalizedTranscriptProviderId: "whisper.cpp",
  normalizedTranscriptSha256: "normalized-hash",
  operatorHomeRebound: true,
  pdfParserProviderId: "poppler.pdf",
  pdfTextSha256: "pdf-hash",
  pythonVersion: "Python 3.11.2",
  reportedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
  schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  vaultCliCommandDiscovered: true,
  vaultRootRebound: true,
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
      childCwdIsIsolated: true,
      codexAppServerHelpBytes: 2048,
      codexCommandDiscovered: true,
      codexHostedConfigShellEnvironmentPolicyAllowlisted: true,
      codexHostedShellMurphPathBytes: 1536,
      codexHostedShellPythonVersion: "Python 3.11.2",
      codexHostedShellVaultCliLlmsBytes: 4096,
      codexVersion: "codex-cli 0.125.0",
      murphCommandDiscovered: true,
      normalizedTranscriptSha256: "normalized-hash",
      operatorHomeRebound: true,
      pdfParserProviderId: "poppler.pdf",
      pdfTextSha256: "pdf-hash",
      pythonVersion: "Python 3.11.2",
      schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
      healthCommonsCatalogHash: "sha256:catalog",
      healthCommonsCliSearchBytes: 512,
      healthCommonsFinnishDrySaunaTitle: "Finnish Dry Sauna",
      reportedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      healthCommonsRuntimeSearchHitKeys: [
        "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      ],
      vaultCliCommandDiscovered: true,
      vaultRootRebound: true,
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

  it("rejects missing or empty Codex preflight proof fields", () => {
    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexCommandDiscovered: "true",
    })).toThrow(
      "Hosted runner smoke result.codexCommandDiscovered must be a boolean.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexHostedConfigShellEnvironmentPolicyAllowlisted: "true",
    })).toThrow(
      "Hosted runner smoke result.codexHostedConfigShellEnvironmentPolicyAllowlisted must be a boolean.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexVersion: "",
    })).toThrow(
      "Hosted runner smoke result.codexVersion must be a non-empty string.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexAppServerHelpBytes: Number.NaN,
    })).toThrow(
      "Hosted runner smoke result.codexAppServerHelpBytes must be a finite number.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexHostedShellVaultCliLlmsBytes: Number.NaN,
    })).toThrow(
      "Hosted runner smoke result.codexHostedShellVaultCliLlmsBytes must be a finite number.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexHostedShellMurphPathBytes: 0,
    })).toThrow(
      "Hosted runner smoke result.codexHostedShellMurphPathBytes must be a positive finite number.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      pythonVersion: "",
    })).toThrow(
      "Hosted runner smoke result.pythonVersion must be a non-empty string.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      pythonVersion: "Python 2.7.18",
    })).toThrow(
      "Hosted runner smoke result.pythonVersion must be a Python 3 version string.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexHostedShellPythonVersion: "not python",
    })).toThrow(
      "Hosted runner smoke result.codexHostedShellPythonVersion must be a Python 3 version string.",
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

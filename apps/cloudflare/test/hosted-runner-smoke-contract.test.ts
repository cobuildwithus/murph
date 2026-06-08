import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  countAssistantCliSurfaceHotPathProofs,
  parseHostedRunnerSmokeInput,
  parseHostedRunnerSmokeResult,
} from "../src/hosted-runner-smoke-contract.js";

const validHostedRunnerSmokeResult = {
  childCwdIsIsolated: true,
  codexAppServerHelpBytes: 2048,
  codexCommandDiscovered: true,
  codexHostedCliSurfaceContractBytes: 37282,
  codexHostedCliSurfaceHotPathProofCount: HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
  codexHostedConfigShellEnvironmentPolicyAllowlisted: true,
  codexHostedCliSchemaVaultOptionHidden: true,
  codexHostedCliVaultCommandProofCount: HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
  codexHostedCliVaultWriteProofCount: HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
  codexHostedShellMurphPathBytes: 1536,
  codexHostedShellPythonVersion: "Python 3.11.2",
  codexHostedShellVaultCliLlmsBytes: 4096,
  codexVersion: "codex-cli 0.125.0",
  healthCommonsCatalogHash: "sha256:catalog",
  healthCommonsCliProtocolListBytes: 768,
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
  normalizedTranscriptSha256: "c".repeat(64),
  operatorHomeRebound: true,
  pdfParserProviderId: "poppler.pdf",
  pdfTextSha256: "b".repeat(64),
  pythonVersion: "Python 3.11.2",
  reportedVaultIdMatchesExpected: true,
  ripgrepCommandDiscovered: true,
  ripgrepVersion: "ripgrep 13.0.0",
  schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  vaultCliCommandDiscovered: true,
  vaultRootRebound: true,
  vaultShowBytes: 128,
  wavTranscriptMatchesExpectedSnippet: true,
  wavTranscriptProviderId: "whisper.cpp",
  wavTranscriptSha256: "a".repeat(64),
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
      codexHostedCliSurfaceContractBytes: 37282,
      codexHostedCliSurfaceHotPathProofCount: HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
      codexHostedConfigShellEnvironmentPolicyAllowlisted: true,
      codexHostedCliSchemaVaultOptionHidden: true,
      codexHostedCliVaultCommandProofCount: HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
      codexHostedCliVaultWriteProofCount: HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
      codexHostedShellMurphPathBytes: 1536,
      codexHostedShellPythonVersion: "Python 3.11.2",
      codexHostedShellVaultCliLlmsBytes: 4096,
      codexVersion: "codex-cli 0.125.0",
      murphCommandDiscovered: true,
      normalizedTranscriptSha256: "c".repeat(64),
      operatorHomeRebound: true,
      pdfParserProviderId: "poppler.pdf",
      pdfTextSha256: "b".repeat(64),
      pythonVersion: "Python 3.11.2",
      ripgrepCommandDiscovered: true,
      ripgrepVersion: "ripgrep 13.0.0",
      schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
      healthCommonsCatalogHash: "sha256:catalog",
      healthCommonsCliProtocolListBytes: 768,
      healthCommonsFinnishDrySaunaTitle: "Finnish Dry Sauna",
      reportedVaultIdMatchesExpected: true,
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
      codexHostedCliSchemaVaultOptionHidden: false,
    })).toThrow(
      "Hosted runner smoke result.codexHostedCliSchemaVaultOptionHidden must be true.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexHostedCliSchemaVaultOptionHidden: "true",
    })).toThrow(
      "Hosted runner smoke result.codexHostedCliSchemaVaultOptionHidden must be a boolean.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexHostedCliVaultCommandProofCount: 0,
    })).toThrow(
      `Hosted runner smoke result.codexHostedCliVaultCommandProofCount must be at least ${HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT}.`,
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexHostedCliVaultWriteProofCount: 0,
    })).toThrow(
      `Hosted runner smoke result.codexHostedCliVaultWriteProofCount must be at least ${HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT}.`,
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
      codexHostedCliSurfaceContractBytes: 0,
    })).toThrow(
      "Hosted runner smoke result.codexHostedCliSurfaceContractBytes must be a positive finite number.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      codexHostedCliSurfaceHotPathProofCount: 0,
    })).toThrow(
      `Hosted runner smoke result.codexHostedCliSurfaceHotPathProofCount must be at least ${HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT}.`,
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

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      ripgrepVersion: "",
    })).toThrow(
      "Hosted runner smoke result.ripgrepVersion must be a non-empty string.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      ripgrepVersion: "not ripgrep",
    })).toThrow(
      "Hosted runner smoke result.ripgrepVersion must be a ripgrep version string.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      wavTranscriptSha256: "raw transcript text",
    })).toThrow(
      "Hosted runner smoke result.wavTranscriptSha256 must be a SHA-256 hex string.",
    );

    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      pdfTextSha256: "raw pdf text",
    })).toThrow(
      "Hosted runner smoke result.pdfTextSha256 must be a SHA-256 hex string.",
    );
  });

  it("rejects failed boolean proof fields", () => {
    const trueProofFields = [
      "childCwdIsIsolated",
      "codexCommandDiscovered",
      "codexHostedConfigShellEnvironmentPolicyAllowlisted",
      "codexHostedCliSchemaVaultOptionHidden",
      "murphCommandDiscovered",
      "normalizedTranscriptMatchesExpectedSnippet",
      "operatorHomeRebound",
      "reportedVaultIdMatchesExpected",
      "ripgrepCommandDiscovered",
      "vaultCliCommandDiscovered",
      "vaultRootRebound",
      "wavTranscriptMatchesExpectedSnippet",
    ] as const;

    for (const field of trueProofFields) {
      expect(() => parseHostedRunnerSmokeResult({
        ...validHostedRunnerSmokeResult,
        [field]: false,
      })).toThrow(`Hosted runner smoke result.${field} must be true.`);
    }
  });

  it("rejects unexpected schemas", () => {
    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      schema: "bad-schema",
    })).toThrow(
      `Hosted runner smoke result.schema must be ${HOSTED_RUNNER_SMOKE_RESULT_SCHEMA}.`,
    );
  });

  it("rejects unexpected result fields", () => {
    expect(() => parseHostedRunnerSmokeResult({
      ...validHostedRunnerSmokeResult,
      stdout: "{}",
    })).toThrow("Hosted runner smoke result must not include unexpected fields.");
  });
});

describe("countAssistantCliSurfaceHotPathProofs", () => {
  it("counts only detailed hot-path command signatures", () => {
    const detailedContract = [
      "- `memory upsert`: args <text>; options --section=Identity|Preferences|Instructions|Context.",
      "- `goal save`: args <title>; options --status=active|paused|completed|abandoned, --horizon=short_term|medium_term|long_term|ongoing, --priority=integer, repeat --domain=string.",
      "- `device account list`: options --provider=string, --source-provider=string.",
      "- `device connect`: args <provider>; options --returnTo=string.",
    ].join("\n");

    expect(countAssistantCliSurfaceHotPathProofs(detailedContract)).toBe(
      HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
    );
    expect(countAssistantCliSurfaceHotPathProofs("- `memory upsert`: Add a memory.")).toBe(0);
    expect(countAssistantCliSurfaceHotPathProofs([
      "- `device connect`: Create a browser-based OAuth connection link.",
      "- `provider connect`: args <provider>; options --returnTo=string.",
    ].join("\n"))).toBe(0);
  });
});

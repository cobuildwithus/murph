import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
  parseHostedRunnerSmokeInput,
  parseHostedRunnerSmokeResult,
} from "../src/hosted-runner-smoke-contract.js";

describe("parseHostedRunnerSmokeInput", () => {
  it("accepts the local smoke payload shape", () => {
    expect(parseHostedRunnerSmokeInput({
      bundle: "bundle-base64",
      expectedPdfText: "fixture text",
      expectedTranscriptSnippet: "hello",
      expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      pdfRelativePath: "raw/smoke/hosted-runner.pdf",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    })).toEqual({
      bundle: "bundle-base64",
      expectedPdfText: "fixture text",
      expectedTranscriptSnippet: "hello",
      expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      pdfRelativePath: "raw/smoke/hosted-runner.pdf",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    });
  });

  it("rejects empty required strings", () => {
    expect(() => parseHostedRunnerSmokeInput({
      bundle: "  ",
      expectedPdfText: "fixture text",
      expectedTranscriptSnippet: null,
      expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      pdfRelativePath: "raw/smoke/hosted-runner.pdf",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    })).toThrow("Hosted runner smoke input.bundle must be a non-empty string.");
  });
});

describe("parseHostedRunnerSmokeResult", () => {
  it("accepts the in-image smoke result shape", () => {
    expect(parseHostedRunnerSmokeResult({
      childCwd: "/tmp/hosted-runner-smoke-launch-123",
      expectedPdfText: "fixture text",
      murphBin: "/app/node_modules/.bin/murph",
      normalizedTranscript: "hello murph smoke test",
      operatorHomeRoot: "/tmp/hosted-runner-smoke/home",
      pdfText: "fixture text",
      reportedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
      vaultCliBin: "/app/node_modules/.bin/vault-cli",
      vaultRoot: "/tmp/hosted-runner-smoke/vault",
      vaultShowBytes: 128,
      wavTranscript: "hello murph smoke test",
    })).toMatchObject({
      murphBin: "/app/node_modules/.bin/murph",
      schema: HOSTED_RUNNER_SMOKE_RESULT_SCHEMA,
      reportedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      vaultShowBytes: 128,
    });
  });

  it("rejects unexpected schemas", () => {
    expect(() => parseHostedRunnerSmokeResult({
      childCwd: "/tmp/cwd",
      expectedPdfText: "fixture text",
      murphBin: "/app/node_modules/.bin/murph",
      normalizedTranscript: "hello",
      operatorHomeRoot: "/tmp/home",
      pdfText: "fixture text",
      reportedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      schema: "bad-schema",
      vaultCliBin: "/app/node_modules/.bin/vault-cli",
      vaultRoot: "/tmp/vault",
      vaultShowBytes: 12,
      wavTranscript: "hello",
    })).toThrow(
      `Hosted runner smoke result.schema must be ${HOSTED_RUNNER_SMOKE_RESULT_SCHEMA}.`,
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  assertHostedAssistantRuntimeJobResultAsync,
} from "../../src/hosted-runtime-result-validation.ts";

const HOSTED_BUNDLE_SCHEMA = "murph.hosted-bundle.v1";

describe("hosted runtime result validation in Workers", () => {
  it("accepts a valid gzip/base64 hosted bundle result", async () => {
    const bundle = await createHostedBundlePayload();
    const result = createRunnerResult(bundle);

    await expect(assertHostedAssistantRuntimeJobResultAsync(result, {
      bundleArchiveOperation: "runner-output",
    })).resolves.toMatchObject({
      result: {
        bundle,
        result: {
          eventsHandled: 0,
          summary: "ok",
        },
      },
    });
  });

  it("rejects a malformed gzip archive as a runner-output validation error", async () => {
    const result = createRunnerResult(encodeBase64(new TextEncoder().encode("not gzip")));

    await expect(assertHostedAssistantRuntimeJobResultAsync(result, {
      bundleArchiveOperation: "runner-output",
    })).rejects.toMatchObject({
      code: "bundle_archive_validation_error",
      details: {
        bundleArchiveOperation: "runner-output",
        bundleRefPresent: false,
      },
      message: "Hosted bundle archive is invalid.",
      name: "HostedBundleArchiveValidationError",
      operation: "runner-output",
    });
  });

  it("rejects malformed base64 as a runner-output validation error", async () => {
    const result = createRunnerResult("%%%");

    await expect(assertHostedAssistantRuntimeJobResultAsync(result, {
      bundleArchiveOperation: "runner-output",
    })).rejects.toMatchObject({
      code: "bundle_archive_validation_error",
      details: {
        bundleArchiveOperation: "runner-output",
        bundleRefPresent: false,
      },
      message: "Hosted bundle archive payload is invalid.",
      name: "HostedBundleArchiveValidationError",
      operation: "runner-output",
    });
  });
});

function createRunnerResult(bundle: string) {
  return {
    finalGatewayProjectionSnapshot: null,
    phase: "completed",
    result: {
      bundle,
      result: {
        eventsHandled: 0,
        summary: "ok",
      },
    },
  };
}

async function createHostedBundlePayload(): Promise<string> {
  const archive = {
    files: [
      {
        contentsBase64: encodeBase64(new TextEncoder().encode("hello")),
        path: "CORE.md",
        root: "vault",
      },
    ],
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  };

  const compressed = await gzipText(JSON.stringify(archive));
  return encodeBase64(compressed);
}

async function gzipText(text: string): Promise<Uint8Array> {
  const input = new Blob([text]).stream();
  const compressed = input.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

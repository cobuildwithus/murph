import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import {
  inputFileOptionSchema,
  loadJsonInputObject,
  loadTextInput,
  normalizeInputFileOption,
  textInputOptionSchema,
} from "@murphai/vault-usecases";
import {
  normalizeRepeatedOption,
  normalizeRepeatableEnumFlagOption,
  normalizeRepeatableFlagOption,
} from "@murphai/vault-usecases";

const originalStdin = process.stdin;
const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");

afterEach(async () => {
  if (stdinDescriptor) {
    Object.defineProperty(process, "stdin", stdinDescriptor);
  } else {
    Object.defineProperty(process, "stdin", {
      configurable: true,
      get: () => originalStdin,
    });
  }
});

function setMockStdin(input: {
  isTTY: boolean;
  chunks?: Array<string | Buffer>;
  error?: Error;
}) {
  const mockStdin = {
    isTTY: input.isTTY,
    async *[Symbol.asyncIterator]() {
      if (input.error) {
        throw input.error;
      }

      for (const chunk of input.chunks ?? []) {
        yield chunk;
      }
    },
  };

  Object.defineProperty(process, "stdin", {
    configurable: true,
    get: () => mockStdin,
  });
}

async function withTempDir<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "vault-usecases-test-"));

  try {
    return await run(tempDir);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

describe("json input helpers", () => {
  it("validates supported input syntaxes and normalizes file markers", () => {
    expect(inputFileOptionSchema.parse("@payload.json")).toBe("@payload.json");
    expect(inputFileOptionSchema.parse("-")).toBe("-");
    expect(() => inputFileOptionSchema.parse("payload.json")).toThrow(
      "Expected an @file.json payload reference or - for stdin.",
    );

    expect(textInputOptionSchema.parse("@payload.txt")).toBe("@payload.txt");
    expect(textInputOptionSchema.parse("-")).toBe("-");
    expect(() => textInputOptionSchema.parse("payload.txt")).toThrow(
      "Expected an @file payload reference or - for stdin.",
    );

    expect(normalizeInputFileOption("@payload.json")).toBe("payload.json");
    expect(normalizeInputFileOption("-")).toBe("-");
    expect(normalizeInputFileOption("payload.json")).toBe("payload.json");
  });

  it("loads valid JSON objects and text payloads from files", async () => {
    await withTempDir(async (tempDir) => {
      const jsonPath = path.join(tempDir, "payload.json");
      const textPath = path.join(tempDir, "payload.txt");

      await writeFile(jsonPath, JSON.stringify({ answer: 42 }), "utf8");
      await writeFile(textPath, "hello world", "utf8");

      await expect(loadJsonInputObject(`@${jsonPath}`, "payload")).resolves.toEqual({
        answer: 42,
      });
      await expect(loadTextInput(`@${textPath}`, "payload")).resolves.toBe("hello world");
      await expect(readFile(textPath, "utf8")).resolves.toBe("hello world");
    });
  });

  it("rejects invalid JSON payload files and missing files", async () => {
    await withTempDir(async (tempDir) => {
      const invalidJsonPath = path.join(tempDir, "invalid.json");
      const arrayJsonPath = path.join(tempDir, "array.json");
      const missingPath = path.join(tempDir, "missing.txt");

      await writeFile(invalidJsonPath, "{not-json", "utf8");
      await writeFile(arrayJsonPath, JSON.stringify(["not", "an", "object"]), "utf8");

      await expect(loadJsonInputObject(`@${invalidJsonPath}`, "payload")).rejects.toMatchObject({
        code: "invalid_payload",
        message: "payload must contain valid JSON.",
      });

      await expect(loadJsonInputObject(`@${arrayJsonPath}`, "payload")).rejects.toMatchObject({
        code: "invalid_payload",
        message: "payload must contain a JSON object.",
      });

      await expect(loadTextInput(`@${missingPath}`, "payload")).rejects.toMatchObject({
        code: "command_failed",
        message: "Failed to read payload file.",
      });
    });
  });

  it("reads piped stdin text and json payloads", async () => {
    setMockStdin({
      isTTY: false,
      chunks: ['{"message":"hello"}'],
    });
    await expect(loadJsonInputObject("-", "payload")).resolves.toEqual({
      message: "hello",
    });

    setMockStdin({
      isTTY: false,
      chunks: ["hello ", Buffer.from("world", "utf8")],
    });
    await expect(loadTextInput("-", "payload")).resolves.toBe("hello world");
  });

  it("fails closed for missing or unreadable stdin", async () => {
    setMockStdin({ isTTY: true });
    await expect(
      loadTextInput("-", "payload", {
        stdinHint: "pipe real text",
      }),
    ).rejects.toMatchObject({
      code: "command_failed",
      message: "No payload was piped to stdin.",
      context: {
        hint: "pipe real text",
      },
    });

    setMockStdin({
      isTTY: false,
      chunks: ["   \n"],
    });
    await expect(loadTextInput("-", "payload")).rejects.toMatchObject({
      code: "command_failed",
      message: "No payload was piped to stdin.",
      context: {
        hint: "Pass --input @file or pipe text to --input -.",
      },
    });

    setMockStdin({
      isTTY: false,
      error: new Error("stdin blew up"),
    });
    await expect(loadTextInput("-", "payload")).rejects.toMatchObject({
      code: "command_failed",
      message: "Failed to read payload from stdin.",
      context: {
        cause: "stdin blew up",
      },
    });
  });
});

describe("repeatable option normalization", () => {
  it("trims, deduplicates, and drops empty repeated options", () => {
    expect(normalizeRepeatedOption(undefined)).toBeUndefined();
    expect(normalizeRepeatedOption([" goal ", "goal", "", " next "])).toEqual([
      "goal",
      "next",
    ]);
    expect(normalizeRepeatedOption(["  ", "\n"])).toBeUndefined();
  });

  it("rejects comma-delimited flags and unsupported enum values", () => {
    expect(() =>
      normalizeRepeatableFlagOption(["goal,condition"], "kind"),
    ).toThrowError(VaultCliError);
    expect(() =>
      normalizeRepeatableFlagOption(["goal,condition"], "kind"),
    ).toThrow("Comma-delimited values are not supported for --kind. Repeat the flag instead.");

    expect(() =>
      normalizeRepeatableEnumFlagOption(["goal", "unknown"], "kind", ["goal", "condition"]),
    ).toThrowError(VaultCliError);
    expect(() =>
      normalizeRepeatableEnumFlagOption(["goal", "unknown"], "kind", ["goal", "condition"]),
    ).toThrow(
      'Unsupported value for --kind: "unknown". Supported values: goal, condition.',
    );
  });

  it("returns normalized enum flags when every value is supported", () => {
    expect(normalizeRepeatableFlagOption(undefined, "kind")).toBeUndefined();
    expect(
      normalizeRepeatableEnumFlagOption(undefined, "kind", ["goal", "condition"]),
    ).toBeUndefined();
    expect(
      normalizeRepeatableEnumFlagOption(
        [" condition ", "goal", "condition"],
        "kind",
        ["goal", "condition"],
      ),
    ).toEqual(["condition", "goal"]);
  });
});

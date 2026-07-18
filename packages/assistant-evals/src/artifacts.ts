import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JsonValue } from "./json.js";
import type { EvalRunResult } from "./result.js";

export async function writeEvalRunArtifact<
  TObservation extends JsonValue,
>(input: {
  readonly run: EvalRunResult<TObservation>;
  readonly outputPath: string;
}): Promise<string> {
  const outputPath = path.resolve(input.outputPath);
  const outputDirectory = path.dirname(outputPath);
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(outputPath)}.${randomUUID()}.tmp`,
  );

  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(input.run, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return outputPath;
}

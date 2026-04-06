import { chmod as fsChmod, mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";

import { readLocalStateTextFile } from "./local-state-files.ts";
import {
  createVersionedJsonStateEnvelope,
  parseVersionedJsonStateEnvelope,
  type ParseVersionedJsonStateEnvelopeInput,
} from "./versioned-json-state.ts";

export interface ReadVersionedJsonStateFileInput<T>
  extends ParseVersionedJsonStateEnvelopeInput<T> {
  currentPath: string;
}

export interface VersionedJsonStateFileReadDependencies {
  readFile(path: string): Promise<string>;
}

export interface VersionedJsonStateFileWriteDependencies {
  chmod(path: string, mode: number): Promise<void>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, text: string): Promise<void>;
}

export async function readVersionedJsonStateFile<T>(
  input: ReadVersionedJsonStateFileInput<T>,
  dependencies?: VersionedJsonStateFileReadDependencies,
): Promise<{ filePath: string; value: T }> {
  const raw = dependencies
    ? await dependencies.readFile(input.currentPath)
    : (await readLocalStateTextFile({ currentPath: input.currentPath })).text;

  return {
    filePath: input.currentPath,
    value: parseVersionedJsonStateEnvelope(JSON.parse(raw) as unknown, input),
  };
}

export async function writeVersionedJsonStateFile<T>(
  input: {
    filePath: string;
    mode?: number;
    schema: string;
    schemaVersion: number;
    value: T;
  },
  dependencies?: VersionedJsonStateFileWriteDependencies,
): Promise<void> {
  const resolvedDependencies = dependencies ?? {
    chmod: fsChmod,
    async mkdir(targetPath: string) {
      await fsMkdir(targetPath, { recursive: true });
    },
    writeFile(filePath: string, text: string) {
      return fsWriteFile(filePath, text, "utf8");
    },
  };

  await resolvedDependencies.mkdir(path.dirname(input.filePath));
  await resolvedDependencies.writeFile(
    input.filePath,
    `${JSON.stringify(createVersionedJsonStateEnvelope(input), null, 2)}\n`,
  );

  if (typeof input.mode === "number") {
    await resolvedDependencies.chmod(input.filePath, input.mode);
  }
}

import { chmod as fsChmod, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureAssistantStateDirectory,
  resolveAssistantStateFileMode,
} from "./assistant-state-security.ts";
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
    value: parseVersionedJsonStateEnvelope(JSON.parse(raw), input),
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
    mkdir: ensureAssistantStateDirectory,
    writeFile(filePath: string, text: string) {
      const mode = resolveAssistantStateFileMode(filePath, input.mode);
      return fsWriteFile(filePath, text, {
        encoding: "utf8",
        mode,
      });
    },
  };
  const fileMode = resolveAssistantStateFileMode(input.filePath, input.mode);

  await resolvedDependencies.mkdir(path.dirname(input.filePath));
  await resolvedDependencies.writeFile(
    input.filePath,
    `${JSON.stringify(createVersionedJsonStateEnvelope(input), null, 2)}\n`,
  );

  if (typeof fileMode === "number") {
    await resolvedDependencies.chmod(input.filePath, fileMode);
  }
}

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  cleanupStaleTestTempRoots,
  MURPH_VITEST_TEMP_MARKER,
  MURPH_VITEST_TEMP_PREFIX,
  resolveMurphTestTempBaseDirectory,
} from "./vitest-temp-lifecycle.js";

const TEMP_ENV_KEYS = ["TMPDIR", "TMP", "TEMP"] as const;
type TempEnvKey = (typeof TEMP_ENV_KEYS)[number] | "MURPH_VITEST_TEMP_ROOT";
type OwnedTempState = {
  originalEnv: Partial<Record<TempEnvKey, string>>;
  references: number;
  tempRoot: string;
};

let ownedTempState: OwnedTempState | undefined;

export default async function setupMurphVitestTempRoot(): Promise<() => Promise<void>> {
  if (ownedTempState) {
    ownedTempState.references += 1;
    setTempEnvironment(ownedTempState.tempRoot);
    return releaseOwnedTempRoot;
  }

  const inheritedRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (inheritedRoot) {
    setTempEnvironment(inheritedRoot);
    return async () => {};
  }

  const baseDirectory = resolveMurphTestTempBaseDirectory();
  await mkdir(baseDirectory, { recursive: true });
  await cleanupStaleTestTempRoots({ apply: true, baseDirectory });

  const originalEnv: Partial<Record<TempEnvKey, string>> = {};
  for (const key of [...TEMP_ENV_KEYS, "MURPH_VITEST_TEMP_ROOT"] as const) {
    const value = process.env[key];
    if (value !== undefined) originalEnv[key] = value;
  }
  const tempRoot = await mkdtemp(path.join(baseDirectory, MURPH_VITEST_TEMP_PREFIX));
  try {
    await chmod(tempRoot, 0o700);
    await writeFile(
      path.join(tempRoot, MURPH_VITEST_TEMP_MARKER),
      `${JSON.stringify({
        schemaVersion: 1,
        ownerPid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    await rm(tempRoot, { force: true, recursive: true }).catch(() => {});
    throw error;
  }

  ownedTempState = { originalEnv, references: 1, tempRoot };
  setTempEnvironment(tempRoot);

  return releaseOwnedTempRoot;
}

function setTempEnvironment(tempRoot: string): void {
  process.env.MURPH_VITEST_TEMP_ROOT = tempRoot;
  for (const key of TEMP_ENV_KEYS) process.env[key] = tempRoot;
}

async function releaseOwnedTempRoot(): Promise<void> {
  const state = ownedTempState;
  if (!state) return;
  state.references -= 1;
  if (state.references > 0) return;

  ownedTempState = undefined;
  for (const key of [...TEMP_ENV_KEYS, "MURPH_VITEST_TEMP_ROOT"] as const) {
    const originalValue = state.originalEnv[key];
    if (originalValue === undefined) delete process.env[key];
    else process.env[key] = originalValue;
  }
  await rm(state.tempRoot, { force: true, recursive: true });
}

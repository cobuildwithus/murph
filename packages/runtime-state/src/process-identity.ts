import { execFile as execFileDefault } from "node:child_process";
import { readFile as readFileDefault } from "node:fs/promises";
import { promisify } from "node:util";

type ExecFile = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string }>;

const execFileDefaultAsync: ExecFile = async (file, args) => {
  const { stdout } = await promisify(execFileDefault)(file, [...args], {
    encoding: "utf8",
  });
  return { stdout: String(stdout) };
};

export interface ProcessIdentity {
  pid: number;
  platform: NodeJS.Platform;
  startToken: string;
}

export interface ProcessIdentityDependencies {
  execFile?: ExecFile;
  platform?: NodeJS.Platform;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
}

export type ProcessIdentityMatch =
  | { matches: true; reason: "matched" }
  | { matches: false; reason: "missing" | "mismatched" | "unverifiable" };

export async function captureProcessIdentity(
  pid: number,
  dependencies: ProcessIdentityDependencies = {},
): Promise<ProcessIdentity | null> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  const platform = dependencies.platform ?? process.platform;
  const startToken = await readProcessStartToken(pid, {
    execFile: dependencies.execFile,
    platform,
    readFile: dependencies.readFile,
  });

  return startToken === null
    ? null
    : {
        pid,
        platform,
        startToken,
      };
}

export async function matchProcessIdentity(
  pid: number,
  expected: ProcessIdentity | null | undefined,
  dependencies: ProcessIdentityDependencies = {},
): Promise<ProcessIdentityMatch> {
  if (!expected) {
    return { matches: false, reason: "unverifiable" };
  }

  if (expected.pid !== pid) {
    return { matches: false, reason: "mismatched" };
  }

  const current = await captureProcessIdentity(pid, {
    ...dependencies,
    platform: dependencies.platform ?? expected.platform,
  });
  if (!current) {
    return { matches: false, reason: "missing" };
  }

  return current.platform === expected.platform && current.startToken === expected.startToken
    ? { matches: true, reason: "matched" }
    : { matches: false, reason: "mismatched" };
}

async function readProcessStartToken(
  pid: number,
  dependencies: Required<Pick<ProcessIdentityDependencies, "platform">> &
    ProcessIdentityDependencies,
): Promise<string | null> {
  if (dependencies.platform === "linux") {
    return readLinuxProcStartToken(pid, dependencies.readFile);
  }

  if (dependencies.platform === "darwin") {
    return readDarwinPsStartToken(pid, dependencies.execFile);
  }

  return null;
}

async function readLinuxProcStartToken(
  pid: number,
  readFile: ProcessIdentityDependencies["readFile"] = readFileDefault,
): Promise<string | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) {
      return null;
    }

    const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/u);
    const startTimeTicks = fieldsAfterCommand[19];
    return startTimeTicks && /^\d+$/u.test(startTimeTicks)
      ? `linux-proc-start:${startTimeTicks}`
      : null;
  } catch {
    return null;
  }
}

async function readDarwinPsStartToken(
  pid: number,
  execFile: ExecFile = execFileDefaultAsync,
): Promise<string | null> {
  try {
    const { stdout } = await execFile("ps", [
      "-o",
      "lstart=",
      "-p",
      String(pid),
    ]);
    const startTime = stdout.trim().replace(/\s+/gu, " ");
    return startTime.length === 0 ? null : `darwin-ps-lstart:${startTime}`;
  } catch {
    return null;
  }
}

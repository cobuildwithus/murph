import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION = "3";
export const NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET = "native-ios-e2e";
export const NATIVE_IOS_HOSTED_E2E_LANE_MARKER = "native-ios-hosted-e2e";
export const HTTP_TIMEOUT_MS = 15_000;
export const POLL_MS = 5_000;
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROCESS_GROUP_POLL_MS = 25;

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 500 || /[\r\n\0]/u.test(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value;
}

export function assertSafeId(value, label, max, pattern = /^[A-Za-z0-9._:-]+$/u) {
  if (!value || value.length > max || !pattern.test(value) || /[\r\n\0]/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

export function assertSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} must be a lowercase 40-character SHA.`);
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} was not an object.`);
}

export function normalizeHttpsOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("web base URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("web base URL must be an origin-only HTTPS URL.");
  }
  return url.origin;
}

export async function fetchJson(url, init, label) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export function inspectBoundedCommandResult({ code, label, maxOutputChars = 0, outputLength = 0, timedOut }) {
  if (timedOut) throw new Error(`${label} timed out.`);
  if (maxOutputChars > 0 && outputLength > maxOutputChars) {
    throw new Error(`${label} returned more output than expected.`);
  }
  if (code !== 0) throw new Error(`${label} failed.`);
  return true;
}

export async function runBoundedCommand({ argv, captureStdout = false, command, env, label, maxOutputChars = 0, timeoutMs }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error(`${label} timeout is invalid.`);
  return new Promise((resolve, reject) => {
    const useProcessGroup = process.platform !== "win32";
    const child = spawn(command, argv, {
      cwd: REPO_ROOT,
      detached: useProcessGroup,
      env,
      stdio: captureStdout ? ["ignore", "pipe", "ignore"] : "ignore",
    });
    const processGroupId = useProcessGroup && typeof child.pid === "number" && child.pid > 0
      ? child.pid
      : null;
    let childClosed = false;
    let code = null;
    let leaderExited = false;
    let output = "";
    let outputOverflow = false;
    let settled = false;
    let spawnFailed = false;
    let supervisionError = null;
    let terminationStarted = false;
    let timedOut = false;

    const cleanup = () => {
      clearInterval(pollTimer);
      clearTimeout(deadlineTimer);
    };
    const terminateOwnedTree = () => {
      if (terminationStarted) return;
      terminationStarted = true;
      try {
        if (processGroupId !== null && processGroupExists(processGroupId)) {
          signalProcessGroup(processGroupId, "SIGKILL");
          return;
        }
        if (!hasChildExited(child)) {
          try {
            child.kill("SIGKILL");
          } catch {
            // The retained exact child may have exited between the state check and signal.
          }
        }
      } catch (error) {
        supervisionError = error;
      }
    };
    const finishIfReaped = () => {
      if (settled || !leaderExited) return;
      let groupExists = false;
      try {
        groupExists = processGroupId !== null && processGroupExists(processGroupId);
      } catch (error) {
        supervisionError = error;
      }
      if (groupExists) {
        if (!terminationStarted) terminateOwnedTree();
        return;
      }
      if (!childClosed) return;

      settled = true;
      cleanup();
      if (spawnFailed) {
        reject(new Error(`${label} could not start.`));
        return;
      }
      if (supervisionError) {
        reject(new Error(`${label} process supervision failed.`, { cause: supervisionError }));
        return;
      }
      try {
        inspectBoundedCommandResult({
          code,
          label,
          maxOutputChars,
          outputLength: outputOverflow ? maxOutputChars + 1 : output.length,
          timedOut,
        });
        resolve(output);
      } catch (error) {
        reject(error);
      }
    };
    const deadlineTimer = setTimeout(() => {
      if (outputOverflow || timedOut) return;
      timedOut = true;
      terminateOwnedTree();
      finishIfReaped();
    }, timeoutMs);
    const pollTimer = setInterval(finishIfReaped, PROCESS_GROUP_POLL_MS);

    if (captureStdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (outputOverflow) return;
        output += chunk;
        if (maxOutputChars > 0 && output.length > maxOutputChars) {
          output = output.slice(0, maxOutputChars + 1);
          outputOverflow = true;
          terminateOwnedTree();
          finishIfReaped();
        }
      });
    }
    child.once("error", () => {
      spawnFailed = true;
      leaderExited = true;
      childClosed = true;
      finishIfReaped();
    });
    child.once("exit", (exitCode) => {
      code = exitCode;
      leaderExited = true;
      finishIfReaped();
    });
    child.once("close", () => {
      childClosed = true;
      finishIfReaped();
    });
  });
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    // The bounded command owners grant no uid-transition authority. EPERM
    // therefore means this numeric group id was reused by a foreign
    // process after the owned group disappeared. Never signal it.
    if (error?.code === "EPERM") return false;
    throw error;
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (error?.code !== "ESRCH" && error?.code !== "EPERM") throw error;
  }
}

function hasChildExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

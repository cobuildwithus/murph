#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const researchRoot = path.join(repoRoot, "output-packages", "research");
const STATE_SCHEMA_VERSION = "murph.research.seam-run.v1";
const VALID_ACTIONS = new Set(["send", "harvest"]);

function usage() {
  return `Usage:
  pnpm research:run --workspace <output-packages/research/...> --seam <label> --action send --lane <lane>
  pnpm research:run --workspace <output-packages/research/...> --seam <label> --action harvest [--lane <lane>]

Examples:
  pnpm research:run --workspace output-packages/research/example --seam 01-charter --action send --lane eragon
  pnpm research:run --workspace output-packages/research/example --seam 01-charter --action harvest
`;
}

function takeOption(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    action: "",
    lane: "",
    seam: "",
    workspace: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--workspace") {
      args.workspace = takeOption(argv, index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--workspace=")) {
      args.workspace = token.slice("--workspace=".length);
      continue;
    }
    if (token === "--seam" || token === "--label") {
      args.seam = takeOption(argv, index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--seam=")) {
      args.seam = token.slice("--seam=".length);
      continue;
    }
    if (token.startsWith("--label=")) {
      args.seam = token.slice("--label=".length);
      continue;
    }
    if (token === "--action") {
      args.action = takeOption(argv, index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--action=")) {
      args.action = token.slice("--action=".length);
      continue;
    }
    if (token === "--lane" || token === "--profile") {
      args.lane = takeOption(argv, index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--lane=")) {
      args.lane = token.slice("--lane=".length);
      continue;
    }
    if (token.startsWith("--profile=")) {
      args.lane = token.slice("--profile=".length);
      continue;
    }
    if (!args.action && VALID_ACTIONS.has(token)) {
      args.action = token;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function toPosixRelative(targetPath) {
  const relativePath = path.relative(repoRoot, targetPath) || ".";
  return relativePath.split(path.sep).join(path.posix.sep);
}

function assertInside(parentDir, childPath, message) {
  const relativePath = path.relative(parentDir, childPath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(message);
  }
}

function resolveWorkspace(workspaceArg) {
  if (!workspaceArg) {
    throw new Error("Missing --workspace.");
  }

  const workspaceDir = path.resolve(repoRoot, workspaceArg);
  assertInside(
    researchRoot,
    workspaceDir,
    "--workspace must point to a directory below output-packages/research.",
  );

  if (!existsSync(workspaceDir)) {
    throw new Error(`Workspace directory does not exist: ${toPosixRelative(workspaceDir)}`);
  }
  if (!lstatSync(workspaceDir).isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${toPosixRelative(workspaceDir)}`);
  }

  return workspaceDir;
}

function normalizeAction(actionArg) {
  const action = actionArg.trim().toLowerCase();
  if (!VALID_ACTIONS.has(action)) {
    throw new Error("Missing or unsupported --action. Use send or harvest.");
  }
  return action;
}

function normalizeSeam(seamArg) {
  const seam = seamArg.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(seam)) {
    throw new Error("Missing or unsafe --seam. Use the generated seam label, such as 01-charter.");
  }
  return seam;
}

function normalizeLane(laneArg) {
  const lane = laneArg.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(lane)) {
    throw new Error("Unsafe --lane. Use a named review-gpt profile slug, such as eragon.");
  }
  return lane;
}

function resolveCommandPath(workspaceDir, seam, action) {
  const commandPath = path.join(workspaceDir, "commands", `${seam}.${action}.sh`);
  assertInside(workspaceDir, commandPath, "Resolved command path escaped the workspace.");
  if (!existsSync(commandPath)) {
    throw new Error(`Missing generated ${action} command: ${toPosixRelative(commandPath)}`);
  }
  if (!lstatSync(commandPath).isFile()) {
    throw new Error(`Generated ${action} command is not a file: ${toPosixRelative(commandPath)}`);
  }
  return commandPath;
}

function resolveProfileHelper() {
  const helperOverride = process.env.MURPH_RESEARCH_PROFILE_HELPER;
  const helperPath = helperOverride
    ? path.resolve(repoRoot, helperOverride)
    : path.join(repoRoot, "scripts", "review-gpt-browser-profile.sh");

  if (!existsSync(helperPath)) {
    throw new Error(`Missing review-gpt profile helper: ${toPosixRelative(helperPath)}`);
  }
  return helperPath;
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed;
}

function statePathFor(workspaceDir, seam) {
  return path.join(workspaceDir, "state", "seams", `${seam}.json`);
}

function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readChatUrl(workspaceDir, seam) {
  const chatUrlPath = path.join(workspaceDir, "state", "chat-urls", `${seam}.txt`);
  if (!existsSync(chatUrlPath)) {
    return "";
  }
  return readFileSync(chatUrlPath, "utf8").trim();
}

function resolveBrowserEndpoint(profileHelper, lane) {
  const result = spawnSync("bash", [profileHelper, "browser-endpoint", lane], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(details || `Unable to resolve browser endpoint for lane ${lane}.`);
  }

  const endpoint = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!endpoint) {
    throw new Error(`Profile helper did not return a browser endpoint for lane ${lane}.`);
  }
  if (/^https?:\/\//u.test(endpoint)) {
    return endpoint;
  }
  return `http://${endpoint}`;
}

function writeRunState({
  action,
  browserEndpoint,
  commandPath,
  exitCode,
  lane,
  phase,
  seam,
  statePath,
  workspaceDir,
}) {
  const now = new Date().toISOString();
  const state = readJsonFile(statePath);
  const actionState = state[action] && typeof state[action] === "object"
    ? state[action]
    : {};
  const baseActionState = phase === "started" ? {} : actionState;

  const nextState = {
    ...state,
    schemaVersion: STATE_SCHEMA_VERSION,
    seam,
    workspace: toPosixRelative(workspaceDir),
    lane,
    browserEndpoint,
    updatedAt: now,
  };

  if (action === "send") {
    delete nextState.harvest;
    delete nextState.harvestedAt;

    const chatUrl = readChatUrl(workspaceDir, seam);
    if (chatUrl) {
      nextState.chatUrl = chatUrl;
    } else {
      delete nextState.chatUrl;
      delete nextState.sentAt;
    }
  }

  nextState[action] = {
    ...baseActionState,
    lane,
    browserEndpoint,
    command: toPosixRelative(commandPath),
    ...(phase === "started"
      ? { startedAt: now, status: "running" }
      : {
          completedAt: now,
          exitCode,
          status: exitCode === 0 ? "completed" : "failed",
        }),
  };

  if (phase === "completed" && exitCode === 0) {
    if (action === "send") {
      if (nextState.chatUrl) {
        nextState.sentAt = now;
      }
    } else {
      nextState.harvestedAt = now;
    }
  }

  writeJsonFile(statePath, nextState);
}

function runLaneCommand(profileHelper, lane, commandPath) {
  const result = spawnSync("bash", [profileHelper, "research", lane, commandPath], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  if (result.signal) {
    console.error(`research ${path.basename(commandPath)} stopped by signal ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const workspaceDir = resolveWorkspace(args.workspace);
  const seam = normalizeSeam(args.seam);
  const action = normalizeAction(args.action);
  const commandPath = resolveCommandPath(workspaceDir, seam, action);
  const statePath = statePathFor(workspaceDir, seam);
  const existingState = readJsonFile(statePath);
  const laneArg = args.lane || (action === "harvest" ? existingState.lane ?? "" : "");

  if (!laneArg) {
    throw new Error(
      action === "send"
        ? "--lane is required for send so the seam is bound to a named browser lane."
        : `No lane recorded for ${seam}. Re-run with --lane <lane> once, then future harvests can omit it.`,
    );
  }

  const lane = normalizeLane(String(laneArg));
  const profileHelper = resolveProfileHelper();
  const browserEndpoint = resolveBrowserEndpoint(profileHelper, lane);

  console.log(
    `Running research ${action} for ${seam} via lane ${lane} (${browserEndpoint}).`,
  );
  writeRunState({
    action,
    browserEndpoint,
    commandPath,
    lane,
    phase: "started",
    seam,
    statePath,
    workspaceDir,
  });

  const exitCode = runLaneCommand(profileHelper, lane, commandPath);

  writeRunState({
    action,
    browserEndpoint,
    commandPath,
    exitCode,
    lane,
    phase: "completed",
    seam,
    statePath,
    workspaceDir,
  });

  if (exitCode === 0) {
    console.log(`Recorded research ${action} state: ${toPosixRelative(statePath)}`);
  }
  return exitCode;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error("");
  console.error(usage().trimEnd());
  process.exitCode = 1;
}

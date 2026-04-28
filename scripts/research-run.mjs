#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  unlinkSync,
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
  pnpm research:run --workspace <output-packages/research/...> --seam <label> --action harvest [--lane <lane> --explore-lane]

Examples:
  pnpm research:run --workspace output-packages/research/example --seam 01-charter --action send --lane hercules
  pnpm research:run --workspace output-packages/research/example --seam 01-charter --action harvest

Options:
  --explore-lane  Allow harvest to intentionally probe a lane that differs from the recorded send lane.
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
    exploreLane: false,
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
    if (token === "--explore-lane") {
      args.exploreLane = true;
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
    throw new Error("Unsafe --lane. Use a named review-gpt profile slug, such as hercules.");
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

function readStateString(state, key) {
  const value = state[key];
  return typeof value === "string" ? value : "";
}

function readActionStateString(state, action, key) {
  const actionState = state[action];
  if (!actionState || typeof actionState !== "object" || Array.isArray(actionState)) {
    return "";
  }
  const value = actionState[key];
  return typeof value === "string" ? value : "";
}

function readRecordedSendLane(state) {
  return readActionStateString(state, "send", "lane") || readStateString(state, "lane");
}

function readRecordedSendEndpoint(state) {
  return (
    readActionStateString(state, "send", "browserEndpoint") ||
    readStateString(state, "browserEndpoint")
  );
}

function statePathFor(workspaceDir, seam) {
  return path.join(workspaceDir, "state", "seams", `${seam}.json`);
}

function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireSendLaneLock(lane, workspaceDir, seam) {
  const locksDir = path.join(researchRoot, "_locks");
  const lockPath = path.join(locksDir, `send-${lane}.lock.json`);
  mkdirSync(locksDir, { recursive: true });
  const lockState = {
    acquiredAt: new Date().toISOString(),
    lane,
    pid: process.pid,
    seam,
    workspace: toPosixRelative(workspaceDir),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, `${JSON.stringify(lockState, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      return () => {
        const current = readJsonFile(lockPath);
        if (current.pid === process.pid) {
          rmSync(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (error && error.code !== "EEXIST") {
        throw error;
      }

      const existing = readJsonFile(lockPath);
      if (!isProcessAlive(Number(existing.pid))) {
        rmSync(lockPath, { force: true });
        continue;
      }

      throw new Error(
        [
          `Refusing to send ${seam} on lane ${lane}: another send is already staging in that browser profile.`,
          `Active send: ${existing.workspace || "unknown-workspace"}:${existing.seam || "unknown-seam"} (pid ${existing.pid})`,
          "Use a different lane or retry after that send records its ChatGPT URL.",
        ].join("\n"),
      );
    }
  }

  throw new Error(`Unable to acquire send lock for lane ${lane}.`);
}

function readChatUrl(workspaceDir, seam) {
  const chatUrlPath = path.join(workspaceDir, "state", "chat-urls", `${seam}.txt`);
  if (!existsSync(chatUrlPath)) {
    return "";
  }
  return readFileSync(chatUrlPath, "utf8").trim();
}

function chatUrlPathFor(workspaceDir, seam) {
  return path.join(workspaceDir, "state", "chat-urls", `${seam}.txt`);
}

function normalizeEndpointUrl(endpoint) {
  return endpoint.replace(/\/+$/u, "");
}

function extractChatConversationId(chatUrl) {
  try {
    const parsed = new URL(chatUrl);
    if (parsed.hostname !== "chatgpt.com") {
      return "";
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length === 2 && segments[0] === "c" && segments[1]
      ? decodeURIComponent(segments[1])
      : "";
  } catch {
    return "";
  }
}

function normalizeChatConversationUrl(chatUrl) {
  const conversationId = extractChatConversationId(chatUrl);
  if (!conversationId) {
    return "";
  }
  return `https://chatgpt.com/c/${conversationId}`;
}

function isCleanChatGptHomeUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return (
      parsed.hostname === "chatgpt.com" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function clearChatUrl(workspaceDir, seam) {
  const chatUrlPath = chatUrlPathFor(workspaceDir, seam);
  if (existsSync(chatUrlPath)) {
    unlinkSync(chatUrlPath);
  }
}

function findActiveChatUrlOwners(chatUrl, currentWorkspaceDir, currentSeam) {
  const owners = [];
  if (!existsSync(researchRoot)) {
    return owners;
  }

  for (const workspaceName of readdirSync(researchRoot)) {
    const workspaceDir = path.join(researchRoot, workspaceName);
    const seamsDir = path.join(workspaceDir, "state", "seams");
    if (!existsSync(seamsDir) || !lstatSync(seamsDir).isDirectory()) {
      continue;
    }

    for (const fileName of readdirSync(seamsDir)) {
      if (!fileName.endsWith(".json")) {
        continue;
      }
      const ownerSeam = fileName.slice(0, -".json".length);
      const isCurrentSeam =
        path.resolve(workspaceDir) === path.resolve(currentWorkspaceDir) &&
        ownerSeam === currentSeam;
      if (isCurrentSeam) {
        continue;
      }

      const state = readJsonFile(path.join(seamsDir, fileName));
      if (normalizeChatConversationUrl(readStateString(state, "chatUrl")) === chatUrl) {
        owners.push(`${toPosixRelative(workspaceDir)}:${ownerSeam}`);
      }
    }
  }

  return owners;
}

function validateSendChatUrl(workspaceDir, seam) {
  const rawChatUrl = readChatUrl(workspaceDir, seam);
  if (!rawChatUrl) {
    return;
  }
  const chatUrl = normalizeChatConversationUrl(rawChatUrl);
  if (!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/u.test(chatUrl)) {
    clearChatUrl(workspaceDir, seam);
    throw new Error(`Refusing to record malformed ChatGPT URL for ${seam}: ${rawChatUrl}`);
  }

  const owners = findActiveChatUrlOwners(chatUrl, workspaceDir, seam);
  if (owners.length > 0) {
    clearChatUrl(workspaceDir, seam);
    throw new Error(
      [
        `Refusing to record ChatGPT URL for ${seam} because it is already owned by another active research seam: ${chatUrl}`,
        ...owners.map((owner) => `- ${owner}`),
      ].join("\n"),
    );
  }
}

function assertSendHasNoExistingChatUrl({ existingState, seam, workspaceDir }) {
  const existingChatUrl = normalizeChatConversationUrl(readStateString(existingState, "chatUrl"));
  if (!existingChatUrl) {
    return;
  }

  if (process.env.RESEARCH_ALLOW_RESEND_WITH_EXISTING_CHAT_URL === "1") {
    console.warn(
      `RESEARCH_ALLOW_RESEND_WITH_EXISTING_CHAT_URL=1 is set; replacing existing ChatGPT URL for ${seam}: ${existingChatUrl}`,
    );
    return;
  }

  throw new Error(
    [
      `Refusing to resend ${seam} because it already has a recorded ChatGPT conversation: ${existingChatUrl}`,
      `Quarantine or clear ${toPosixRelative(statePathFor(workspaceDir, seam))} first if this is an intentional retry.`,
    ].join("\n"),
  );
}

function findVisibleChatGptSendBlockers(browserEndpoint) {
  const targets = readBrowserTargets(browserEndpoint);
  return targets
    .map((target) => {
      if (!target || typeof target !== "object") {
        return null;
      }
      const targetUrl = typeof target.url === "string" ? target.url : "";
      if (!targetUrl.startsWith("https://chatgpt.com/")) {
        return null;
      }
      if (isCleanChatGptHomeUrl(targetUrl)) {
        return null;
      }
      const chatUrl = normalizeChatConversationUrl(targetUrl);
      return {
        chatUrl,
        targetUrl,
        title: typeof target.title === "string" ? target.title : "",
      };
    })
    .filter(Boolean);
}

function assertSendLaneHasNoForeignChatTargets({ browserEndpoint, lane, seam, workspaceDir }) {
  const visibleTargets = findVisibleChatGptSendBlockers(browserEndpoint);

  if (visibleTargets.length > 0) {
    throw new Error(
      [
        `Refusing to send ${seam} on lane ${lane}: that browser profile has open ChatGPT conversation or draft tabs.`,
        "Until autosend can prove it is submitting from a fresh new-chat composer, sends require a lane with only clean ChatGPT home tabs visible. Harvests may keep existing conversation tabs open.",
        ...visibleTargets.flatMap((target) => {
          const owners = target.chatUrl
            ? findActiveChatUrlOwners(target.chatUrl, workspaceDir, seam)
            : [];
          const ownerLines = target.chatUrl
            ? owners.length > 0
              ? owners.map((owner) => `  owner: ${owner}`)
              : ["  owner: untracked by active research state"]
            : ["  owner: non-conversation ChatGPT tab or temporary draft"];
          return [`- ${target.chatUrl || target.targetUrl}`, ...ownerLines];
        }),
      ].join("\n"),
    );
  }
}

function readBrowserTargets(browserEndpoint) {
  const endpoint = normalizeEndpointUrl(browserEndpoint);
  const script = `
const endpoint = process.argv[1];
const urls = [endpoint + "/json/list", endpoint + "/json"];
const timeoutMs = 2500;
async function readTargets() {
  let lastError = "";
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        lastError = "HTTP " + response.status + " from " + url;
        continue;
      }
      const parsed = await response.json();
      if (Array.isArray(parsed)) {
        process.stdout.write(JSON.stringify(parsed));
        return;
      }
      lastError = "non-array target list from " + url;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  process.stderr.write(lastError || "unable to read browser target list");
  process.exit(1);
}
readTargets();
`;
  const result = spawnSync(process.execPath, ["-e", script, endpoint], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 8000,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(`Unable to inspect browser targets at ${browserEndpoint}: ${details}`);
  }

  const parsed = JSON.parse(result.stdout || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

function assertExploratoryConversationVisible({
  browserEndpoint,
  chatUrl,
  lane,
  recordedLane,
  seam,
}) {
  const conversationId = extractChatConversationId(chatUrl);
  if (!conversationId) {
    throw new Error(
      `Refusing exploratory harvest for ${seam} on ${lane}: no saved ChatGPT conversation URL was found.`,
    );
  }

  const targets = readBrowserTargets(browserEndpoint);
  const visibleTarget = targets.find((target) => {
    if (!target || typeof target !== "object") {
      return false;
    }
    const targetUrl = typeof target.url === "string" ? target.url : "";
    return extractChatConversationId(targetUrl) === conversationId;
  });

  if (!visibleTarget) {
    throw new Error(
      [
        `Refusing exploratory harvest for ${seam} on ${lane}: ChatGPT conversation ${conversationId} is not visible in that browser profile.`,
        `This seam was sent on ${recordedLane}; run without --lane to use the recorded lane, or visibly load the saved conversation in ${lane} before retrying with --explore-lane.`,
      ].join("\n"),
    );
  }
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
  const recordedSendLane = readRecordedSendLane(state);
  const recordedSendEndpoint = readRecordedSendEndpoint(state);
  const actionState = state[action] && typeof state[action] === "object"
    ? state[action]
    : {};
  const baseActionState = phase === "started" ? {} : actionState;
  const topLevelLane = action === "send" || !recordedSendLane ? lane : recordedSendLane;
  const topLevelEndpoint =
    action === "send" || !recordedSendEndpoint ? browserEndpoint : recordedSendEndpoint;

  const nextState = {
    ...state,
    schemaVersion: STATE_SCHEMA_VERSION,
    seam,
    workspace: toPosixRelative(workspaceDir),
    lane: topLevelLane,
    browserEndpoint: topLevelEndpoint,
    updatedAt: now,
  };

  if (action === "send") {
    delete nextState.harvest;
    delete nextState.harvestedAt;

    const chatUrl = readChatUrl(workspaceDir, seam);
    if (chatUrl) {
      nextState.chatUrl = chatUrl;
    } else if (phase === "completed" && exitCode === 0) {
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

function laneMismatchMessage({ existingState, requestedLane, recordedLane, seam }) {
  const recordedEndpoint = readRecordedSendEndpoint(existingState);
  const recordedSuffix = recordedEndpoint ? ` (${recordedEndpoint})` : "";
  return [
    `Refusing to harvest ${seam} from lane ${requestedLane}: this seam was sent on ${recordedLane}${recordedSuffix}.`,
    'Wrong browser profiles often surface as "Unable to load conversation" or wake timeouts.',
    `Run without --lane to use the recorded send lane, or pass --explore-lane with --lane ${requestedLane} to intentionally probe that profile.`,
  ].join("\n");
}

function resolveLaneForRun({ action, args, existingState, seam }) {
  if (action === "send") {
    if (!args.lane) {
      throw new Error("--lane is required for send so the seam is bound to a named browser lane.");
    }
    return {
      exploratoryMismatch: false,
      lane: normalizeLane(String(args.lane)),
    };
  }

  const recordedLane = readRecordedSendLane(existingState);
  if (!args.lane) {
    if (!recordedLane) {
      throw new Error(
        `No lane recorded for ${seam}. Re-run with --lane <lane> once, then future harvests can omit it.`,
      );
    }
    return {
      exploratoryMismatch: false,
      lane: normalizeLane(recordedLane),
    };
  }

  const lane = normalizeLane(String(args.lane));
  if (recordedLane) {
    const normalizedRecordedLane = normalizeLane(recordedLane);
    if (lane !== normalizedRecordedLane && !args.exploreLane) {
      throw new Error(
        laneMismatchMessage({
          existingState,
          requestedLane: lane,
          recordedLane: normalizedRecordedLane,
          seam,
        }),
      );
    }
    return {
      exploratoryMismatch: lane !== normalizedRecordedLane,
      lane,
    };
  }

  if (args.exploreLane) {
    console.warn("--explore-lane was ignored because this seam has no recorded send lane.");
  }
  return {
    exploratoryMismatch: false,
    lane,
  };
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
  const laneSelection = resolveLaneForRun({ action, args, existingState, seam });
  const lane = laneSelection.lane;
  const profileHelper = resolveProfileHelper();
  const browserEndpoint = resolveBrowserEndpoint(profileHelper, lane);
  let releaseSendLaneLock = () => {};

  if (action === "send") {
    assertSendHasNoExistingChatUrl({
      existingState,
      seam,
      workspaceDir,
    });
    releaseSendLaneLock = acquireSendLaneLock(lane, workspaceDir, seam);
    try {
      assertSendLaneHasNoForeignChatTargets({
        browserEndpoint,
        lane,
        seam,
        workspaceDir,
      });
      clearChatUrl(workspaceDir, seam);
    } catch (error) {
      releaseSendLaneLock();
      releaseSendLaneLock = () => {};
      throw error;
    }
  }

  if (laneSelection.exploratoryMismatch) {
    const recordedEndpoint = readRecordedSendEndpoint(existingState);
    const recordedLane = normalizeLane(readRecordedSendLane(existingState));
    const recordedSuffix = recordedEndpoint ? ` (${recordedEndpoint})` : "";
    const chatUrl = readStateString(existingState, "chatUrl") || readChatUrl(workspaceDir, seam);
    assertExploratoryConversationVisible({
      browserEndpoint,
      chatUrl,
      lane,
      recordedLane,
      seam,
    });
    console.warn(
      `Exploratory harvest override for ${seam}: sent on ${recordedLane}${recordedSuffix}, trying ${lane} (${browserEndpoint}).`,
    );
  }

  try {
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

    let exitCode = runLaneCommand(profileHelper, lane, commandPath);

    if (action === "send" && exitCode === 0) {
      try {
        validateSendChatUrl(workspaceDir, seam);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        exitCode = 69;
      }
    }

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
  } finally {
    releaseSendLaneLock();
  }
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

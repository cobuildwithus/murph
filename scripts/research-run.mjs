#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
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
  pnpm research:run --workspace <output-packages/research/...> --seam <label> --action harvest

Examples:
  pnpm research:run --workspace output-packages/research/example --seam 01-charter --action send --lane hercules
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

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
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

function listFilesRecursive(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
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

function chatUrlMentionedInFile(filePath, chatUrl) {
  const content = readFileSync(filePath, "utf8");
  if (normalizeChatConversationUrl(content.trim()) === chatUrl) {
    return true;
  }

  const matches = content.match(/https?:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+/gu) ?? [];
  return matches.some((match) => normalizeChatConversationUrl(match) === chatUrl);
}

function isCurrentSeamStatePath(filePath, workspaceDir, seam) {
  return filePath === statePathFor(workspaceDir, seam) || filePath === chatUrlPathFor(workspaceDir, seam);
}

function isChatUrlOwnerPath(filePath) {
  const normalizedPath = filePath.split(path.sep).join(path.posix.sep);
  return (
    /\/state\/seams\/[^/]+\.json$/u.test(normalizedPath) ||
    /\/state\/chat-urls\/[^/]+\.txt$/u.test(normalizedPath) ||
    /\/state\/abandoned\/[^/]+\/seam-state\.json$/u.test(normalizedPath) ||
    /\/state\/abandoned\/[^/]+\/chat-url\.txt$/u.test(normalizedPath)
  );
}

function findResearchChatUrlOwners(chatUrl, { includeAbandoned, seam, workspaceDir }) {
  const owners = [];
  const workspaceEntries = existsSync(researchRoot)
    ? readdirSync(researchRoot, { withFileTypes: true })
    : [];
  const stateRoots = workspaceEntries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => listFilesRecursive(path.join(researchRoot, entry.name, "state")))
    .filter((filePath) => filePath.endsWith(".json") || filePath.endsWith(".txt"))
    .filter((filePath) => isChatUrlOwnerPath(filePath))
    .filter((filePath) => includeAbandoned || !filePath.includes(`${path.sep}abandoned${path.sep}`));

  for (const filePath of stateRoots) {
    if (isCurrentSeamStatePath(filePath, workspaceDir, seam)) {
      continue;
    }
    try {
      if (chatUrlMentionedInFile(filePath, chatUrl)) {
        owners.push(toPosixRelative(filePath));
      }
    } catch {
      // Ignore malformed historical state while scanning for URL ownership.
    }
  }

  return owners;
}

function assertChatUrlHasNoOtherOwners({ chatUrl, includeAbandoned, seam, workspaceDir }) {
  const owners = findResearchChatUrlOwners(chatUrl, {
    includeAbandoned,
    seam,
    workspaceDir,
  });
  if (owners.length === 0) {
    return;
  }

  const ownerLines = owners.slice(0, 5).map((owner) => `- ${owner}`);
  const remaining = owners.length > ownerLines.length
    ? [`- ...and ${owners.length - ownerLines.length} more`]
    : [];
  throw new Error(
    [
      `Refusing to use ${chatUrl} for ${seam} because it is already recorded by another research seam.`,
      ...ownerLines,
      ...remaining,
      "Quarantine the stale owner or re-send this seam into a fresh conversation before harvesting.",
    ].join("\n"),
  );
}

function readBrowserTargets(browserEndpoint) {
  const endpoint = browserEndpoint.replace(/\/+$/u, "");
  const result = spawnSync("curl", ["--silent", "--show-error", "--fail", "--max-time", "2", `${endpoint}/json/list`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`Unable to inspect browser targets at ${browserEndpoint}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(`Unable to inspect browser targets at ${browserEndpoint}: ${details || `curl exited ${result.status}`}`);
  }

  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed)) {
    throw new Error(`Browser target list at ${browserEndpoint} was not an array.`);
  }
  return parsed
    .filter((target) => target && typeof target === "object")
    .map((target) => ({
      id: typeof target.id === "string" ? target.id : "",
      type: typeof target.type === "string" ? target.type : "",
      url: typeof target.url === "string" ? target.url : "",
    }));
}

function findBrowserTargetForUrl(browserEndpoint, targetUrl) {
  return readBrowserTargets(browserEndpoint).find(
    (target) => target.type === "page" && target.url === targetUrl,
  );
}

function findBrowserTargetForChatUrl(browserEndpoint, chatUrl) {
  return readBrowserTargets(browserEndpoint).find(
    (target) => target.type === "page" && normalizeChatConversationUrl(target.url) === chatUrl,
  );
}

function assertChatUrlVisibleInLane({ action, browserEndpoint, chatUrl, lane, seam }) {
  const target = findBrowserTargetForChatUrl(browserEndpoint, chatUrl);
  if (target) {
    return;
  }

  throw new Error(
    [
      `Refusing to ${action} ${seam}: saved ChatGPT conversation is not visible in lane ${lane} (${browserEndpoint}).`,
      `Conversation: ${chatUrl}`,
      "This usually means the saved URL is stale, the tab was lost, or another seam recorded the wrong conversation.",
      "Quarantine the saved state and re-send the seam instead of forcing a wake on this lane.",
    ].join("\n"),
  );
}

function validateSendChatUrl(workspaceDir, seam) {
  const rawChatUrl = readChatUrl(workspaceDir, seam);
  if (!rawChatUrl) {
    return;
  }
  const chatUrl = normalizeChatConversationUrl(rawChatUrl);
  if (!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/u.test(chatUrl)) {
    throw new Error(`Refusing to record malformed ChatGPT URL for ${seam}: ${rawChatUrl}`);
  }
  return chatUrl;
}

function validateHarvestChatUrl({ existingState, seam, workspaceDir }) {
  const rawChatUrl = readStateString(existingState, "chatUrl") || readChatUrl(workspaceDir, seam);
  if (!rawChatUrl) {
    throw new Error(
      `Refusing to harvest ${seam} because it has no recorded ChatGPT conversation URL.`,
    );
  }
  const chatUrl = normalizeChatConversationUrl(rawChatUrl);
  if (!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/u.test(chatUrl)) {
    throw new Error(`Refusing to harvest ${seam} with malformed ChatGPT URL: ${rawChatUrl}`);
  }
  return chatUrl;
}

function assertSendHasNoExistingChatUrl({ existingState, seam, workspaceDir }) {
  const existingChatUrl =
    normalizeChatConversationUrl(readStateString(existingState, "chatUrl")) ||
    normalizeChatConversationUrl(readChatUrl(workspaceDir, seam));
  if (!existingChatUrl) {
    return;
  }

  throw new Error(
    [
      `Refusing to send ${seam} because it already has a recorded ChatGPT conversation: ${existingChatUrl}`,
      `Quarantine or clear ${toPosixRelative(statePathFor(workspaceDir, seam))} and ${toPosixRelative(chatUrlPathFor(workspaceDir, seam))} first if this is an intentional retry.`,
    ].join("\n"),
  );
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

function sendTargetUrlFor({ lane, seam, workspaceDir }) {
  const workspaceSlug = path.basename(workspaceDir)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64) || "research";
  const token = [
    workspaceSlug,
    seam,
    lane,
    Date.now().toString(36),
    process.pid.toString(36),
  ]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-");
  return `https://chatgpt.com/?murph_new_research_chat=${encodeURIComponent(token)}`;
}

function writeSendReviewGptConfig(workspaceDir, seam) {
  const configDir = path.join(workspaceDir, "state", "runtime-configs");
  mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, `${seam}.send.review-gpt.config.sh`);
  writeFileSync(
    configPath,
    [
      "#!/usr/bin/env bash",
      "",
      "script_dir=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
      "workspace_dir=\"$(cd \"${script_dir}/../..\" && pwd)\"",
      "",
      "base_config=\"${workspace_dir}/config/review-gpt-work-profile.sh\"",
      "if [[ ! -f \"${base_config}\" ]]; then",
      "  base_config=\"${workspace_dir}/config/review-gpt-research.config.sh\"",
      "fi",
      "",
      "# shellcheck source=/dev/null",
      ". \"${base_config}\"",
      "",
      "chatgpt_url=\"${RESEARCH_SEND_CHATGPT_URL:-${chatgpt_url:-https://chatgpt.com/}}\"",
      "",
    ].join("\n"),
    "utf8",
  );
  return configPath;
}

function openFreshSendTarget({ browserEndpoint, chatgptUrl, seam }) {
  const endpoint = browserEndpoint.replace(/\/+$/u, "");
  const openUrl = `${endpoint}/json/new?${chatgptUrl}`;
  let result = spawnSync("curl", ["--silent", "--show-error", "--fail", "--request", "PUT", "--max-time", "5", openUrl], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    result = spawnSync("curl", ["--silent", "--show-error", "--fail", "--max-time", "5", openUrl], {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    });
  }

  if (result.error) {
    throw new Error(`Unable to open a fresh ChatGPT send tab for ${seam}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `Unable to open a fresh ChatGPT send tab for ${seam}: ${details || `curl exited ${result.status}`}`,
    );
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (findBrowserTargetForUrl(browserEndpoint, chatgptUrl)) {
      return;
    }
  }

  throw new Error(
    [
      `Opened a fresh ChatGPT send tab for ${seam}, but the lane did not expose the expected URL.`,
      `Expected: ${chatgptUrl}`,
      "Refusing to send because review:gpt could fall back to an existing conversation tab.",
    ].join("\n"),
  );
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

    const chatUrl = phase === "completed" && exitCode === 0 ? readChatUrl(workspaceDir, seam) : "";
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

function runLaneCommand(profileHelper, lane, commandPath, env = process.env) {
  const result = spawnSync("bash", [profileHelper, "research", lane, commandPath], {
    cwd: repoRoot,
    env,
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
    "Run without --lane to use the recorded send lane.",
  ].join("\n");
}

function resolveLaneForRun({ action, args, existingState, seam }) {
  if (action === "send") {
    if (!args.lane) {
      throw new Error("--lane is required for send so the seam is bound to a named browser lane.");
    }
    return {
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
      lane: normalizeLane(recordedLane),
    };
  }

  const lane = normalizeLane(String(args.lane));
  if (recordedLane) {
    const normalizedRecordedLane = normalizeLane(recordedLane);
    if (lane !== normalizedRecordedLane) {
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
      lane,
    };
  }
  return {
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

  if (action === "send") {
    assertSendHasNoExistingChatUrl({
      existingState,
      seam,
      workspaceDir,
    });
  } else {
    const chatUrl = validateHarvestChatUrl({
      existingState,
      seam,
      workspaceDir,
    });
    assertChatUrlHasNoOtherOwners({
      chatUrl,
      includeAbandoned: true,
      seam,
      workspaceDir,
    });
    assertChatUrlVisibleInLane({
      action,
      browserEndpoint,
      chatUrl,
      lane,
      seam,
    });
  }

  console.log(
    `Running research ${action} for ${seam} via lane ${lane} (${browserEndpoint}).`,
  );

  let commandEnv = process.env;
  if (action === "send") {
    const sendChatgptUrl = sendTargetUrlFor({ lane, seam, workspaceDir });
    const sendReviewGptConfig = writeSendReviewGptConfig(workspaceDir, seam);
    openFreshSendTarget({
      browserEndpoint,
      chatgptUrl: sendChatgptUrl,
      seam,
    });
    commandEnv = {
      ...process.env,
      RESEARCH_REVIEW_GPT_CONFIG: sendReviewGptConfig,
      RESEARCH_SEND_CHATGPT_URL: sendChatgptUrl,
    };
    console.log(`Prepared fresh ChatGPT send tab: ${sendChatgptUrl}`);
    console.log(`Review:gpt send config: ${toPosixRelative(sendReviewGptConfig)}`);
  }

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

  let exitCode = runLaneCommand(profileHelper, lane, commandPath, commandEnv);

  if (action === "send" && exitCode === 0) {
    try {
      const chatUrl = validateSendChatUrl(workspaceDir, seam);
      if (chatUrl) {
        assertChatUrlHasNoOtherOwners({
          chatUrl,
          includeAbandoned: true,
          seam,
          workspaceDir,
        });
        assertChatUrlVisibleInLane({
          action: "record",
          browserEndpoint,
          chatUrl,
          lane,
          seam,
        });
      }
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

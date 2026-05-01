#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
let currentRepoRoot = process.cwd();
const ALLOWED_CONTEXT_URL = "https://github.com/cobuildwithus/murph";

function redactLocalPaths(value) {
  let redacted = String(value);
  if (currentRepoRoot) {
    redacted = redacted.replaceAll(currentRepoRoot, "<REPO_ROOT>");
  }
  if (process.env.HOME) {
    redacted = redacted.replaceAll(process.env.HOME, "<HOME_DIR>");
  }
  return redacted;
}

process.on("uncaughtException", (error) => {
  console.error(redactLocalPaths(error instanceof Error ? error.message : error));
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(redactLocalPaths(error instanceof Error ? error.message : error));
  process.exit(1);
});

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  args.splice(index, 2);
  return value;
}

const rawArgs = process.argv.slice(2);
const repoRoot = resolve(takeOption(rawArgs, "--repo-root") ?? process.cwd());
currentRepoRoot = repoRoot;
const configPath = resolve(repoRoot, takeOption(rawArgs, "--config") ?? "scripts/review-gpt.config.sh");
const contextUrl = takeOption(rawArgs, "--context-url");

if (!contextUrl) {
  throw new Error("Missing --context-url.");
}
if (contextUrl !== ALLOWED_CONTEXT_URL) {
  throw new Error(`Unsupported review-gpt context URL. Expected ${ALLOWED_CONTEXT_URL}.`);
}

function readFlag(args, name) {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index === -1) return false;
  const [arg] = args.splice(index, 1);
  if (arg.includes("=")) {
    return /^(1|true|yes|on)$/iu.test(arg.split("=").slice(1).join("="));
  }
  const next = args[index];
  if (next && /^(true|false|1|0|yes|no|on|off)$/iu.test(next)) {
    args.splice(index, 1);
    return /^(1|true|yes|on)$/iu.test(next);
  }
  return true;
}

function readValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; ) {
    const arg = args[index];
    if (arg === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
      values.push(value);
      args.splice(index, 2);
      continue;
    }
    if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
      args.splice(index, 1);
      continue;
    }
    index += 1;
  }
  return values;
}

function splitPresetTokens(values) {
  return values.flatMap((value) => value.split(/[,\s]+/u).map((token) => token.trim()).filter(Boolean));
}

const args = [...rawArgs];
const listPresets = readFlag(args, "--list-presets");
const dryRun = readFlag(args, "--dry-run");
const sendFlag = readFlag(args, "--send");
const submitFlag = readFlag(args, "--submit");
const send = sendFlag || submitFlag;
const wait = readFlag(args, "--wait");
const deepResearch = readFlag(args, "--deep-research");
readFlag(args, "--with-tests");
readFlag(args, "--no-tests");
readFlag(args, "--browser-binary");

const presetTokens = splitPresetTokens(readValues(args, "--preset"));
const promptChunks = readValues(args, "--prompt");
const promptFiles = readValues(args, "--prompt-file");
const model = readValues(args, "--model").at(-1);
const thinking = readValues(args, "--thinking").at(-1);
const chat = readValues(args, "--chat").at(-1) ?? readValues(args, "--chat-url").at(-1) ?? readValues(args, "--chat-id").at(-1);
const timeout = readValues(args, "--timeout").at(-1);
const waitTimeout = readValues(args, "--wait-timeout").at(-1);
const responseFile = readValues(args, "--response-file").at(-1);
readValues(args, "--browser-path");

for (const arg of args) {
  if (arg.startsWith("-")) {
    throw new Error(`Unsupported link-only review:gpt option: ${arg}`);
  }
  presetTokens.push(...splitPresetTokens([arg]));
}

if (listPresets) {
  const result = spawnSync("pnpm", ["exec", "cobuild-review-gpt", "--config", configPath, "--list-presets"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function loadConfig() {
  const packageRoot = dirname(require.resolve("@cobuild/review-gpt/package.json"));
  const compatScript = join(packageRoot, "src", "review-gpt-config-compat.sh");
  const result = spawnSync("bash", [compatScript, repoRoot, configPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error("Failed to load review-gpt config.");
  }
  const line = result.stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  return JSON.parse(line ?? "{}");
}

const config = loadConfig();

function normalizeToken(value) {
  return String(value).toLowerCase().replace(/\s+/gu, "");
}

function resolvePreset(token) {
  const normalized = normalizeToken(token);
  if (config.presets?.some((preset) => preset.name === normalized)) return [normalized];
  const alias = config.presetAliases?.find((entry) => entry.input === normalized)?.target;
  if (alias) return [alias];
  const group = config.presetGroups?.find((entry) => entry.name === normalized);
  if (group) return group.members.flatMap(resolvePreset);
  throw new Error(`Unknown preset '${token}'. Run --list-presets to see valid names.`);
}

const selectedPresets = [...new Set(presetTokens.flatMap(resolvePreset))];

function resolveRepoPath(value) {
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

function readPresetText(name) {
  const preset = config.presets.find((entry) => entry.name === name);
  if (!preset) throw new Error(`Unknown preset '${name}'.`);
  const presetPath = resolveRepoPath(preset.path);
  if (!existsSync(presetPath)) throw new Error(`Preset file not found: ${preset.path}`);
  return readFileSync(presetPath, "utf8").trimEnd();
}

function parseDurationToMs(value, fallback) {
  if (!value) return fallback;
  if (/^\d+$/u.test(value)) return Number(value);
  const matches = [...String(value).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/giu)];
  if (matches.length === 0) throw new Error(`Invalid duration: ${value}`);
  return Math.round(matches.reduce((total, match) => {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    return total + amount * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1);
  }, 0));
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function resolveChatUrl() {
  const base = config.chatgptUrl || "https://chatgpt.com";
  if (deepResearch && !chat) return "https://chatgpt.com/deep-research";
  if (!chat) return base;
  if (/^https?:\/\//iu.test(chat)) return chat;
  const origin = new URL(base).origin;
  return `${origin}/c/${chat.replace(/^\/?c\//u, "")}`;
}

const baseCommit = gitHead();
const prompt = [
  ...selectedPresets.map(readPresetText),
  ...promptFiles.map((file) => readFileSync(resolveRepoPath(file), "utf8").trimEnd()),
  ...promptChunks,
  [
    `Repository context: ${contextUrl}`,
    "Use the linked Murph GitHub repository as the source context for this review.",
    "No repo snapshot, repomix, patch, or other local file is attached by this local review:gpt configuration.",
    baseCommit ? `Base commit: ${baseCommit}` : "",
  ].filter(Boolean).join("\n"),
].filter(Boolean).join("\n\n");

const draftTimeoutMs = parseDurationToMs(timeout, wait && deepResearch ? 2_400_000 : wait ? 600_000 : 90_000);
const responseTimeoutMs = parseDurationToMs(waitTimeout, draftTimeoutMs);
const autoSend = send || wait;

console.log(`Prompt presets: ${selectedPresets.length > 0 ? selectedPresets.join(" ") : "(none)"}`);
console.log(`Prompt staging: inline composer prefill (${prompt.length} chars)`);
console.log(`Repository context URL: ${contextUrl}`);
console.log("Attachments: disabled");
console.log(`BASE_COMMIT: ${baseCommit || "(unavailable)"}`);
console.log(`ChatGPT URL: ${resolveChatUrl()}`);
console.log(`ChatGPT mode: ${deepResearch ? "deep-research" : "chat"}`);
console.log(`Draft send: ${autoSend ? "enabled (auto-submit)" : "disabled"}`);
console.log(`Response capture: ${wait ? `enabled (${responseTimeoutMs}ms timeout)` : "disabled"}`);

if (dryRun) {
  console.log("Dry run: browser launch skipped");
  process.exit(0);
}

const packageRoot = dirname(require.resolve("@cobuild/review-gpt/package.json"));
const prepareScript = join(packageRoot, "src", "prepare-chatgpt-draft.js");
const result = spawnSync(process.execPath, [prepareScript], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ORACLE_DRAFT_FILES: "",
    ORACLE_DRAFT_MODE: deepResearch ? "deep-research" : "chat",
    ORACLE_DRAFT_MODEL: model ?? config.model ?? (deepResearch ? "current" : "gpt-5.5-pro"),
    ORACLE_DRAFT_PROMPT: prompt,
    ORACLE_DRAFT_REMOTE_PORT:
      process.env.MURPH_REVIEW_GPT_PROFILE_PORT ?? config.managedBrowserPort ?? config.remotePort ?? "9442",
    ORACLE_DRAFT_RESPONSE_FILE: responseFile ? resolve(process.cwd(), responseFile) : config.responseFile ?? "",
    ORACLE_DRAFT_RESPONSE_TIMEOUT_MS: String(responseTimeoutMs),
    ORACLE_DRAFT_SEND: autoSend ? "1" : "0",
    ORACLE_DRAFT_THINKING: thinking ?? config.thinking ?? "current",
    ORACLE_DRAFT_TIMEOUT_MS: String(draftTimeoutMs),
    ORACLE_DRAFT_URL: resolveChatUrl(),
    ORACLE_DRAFT_WAIT_RESPONSE: wait ? "1" : "0",
  },
});

process.exit(result.status ?? 1);

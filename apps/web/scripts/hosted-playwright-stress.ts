import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, request } from "@playwright/test";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type StressRequest = {
  body?: string;
  headers?: Record<string, string>;
  label?: string;
  method: HttpMethod;
  url: string;
};

type ParsedArgs = {
  flags: Map<string, string[]>;
  positionals: string[];
};

const DEFAULT_BASE_URL = "https://www.withmurph.ai";
const DEFAULT_BROWSER_CHANNEL = "chrome";
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_REQUESTS = 50;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STATE_FILE = path.join(
  os.homedir(),
  ".murph-playwright",
  "hosted-web-stress-state.json",
);

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [command] = parsed.positionals;

  if (!command || command === "help" || hasFlag(parsed, "help")) {
    printUsage();
    return;
  }

  if (command === "login") {
    await runLogin(parsed);
    return;
  }

  if (command === "run") {
    await runStress(parsed);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function runLogin(parsed: ParsedArgs): Promise<void> {
  const inviteUrl = getSingleFlag(parsed, "invite-url");
  const url = getSingleFlag(parsed, "url") ?? inviteUrl;
  const stateFile = resolveStateFile(getSingleFlag(parsed, "state-file"));
  const browserChannel = getSingleFlag(parsed, "browser-channel") ?? DEFAULT_BROWSER_CHANNEL;
  const browserExecutablePath = getSingleFlag(parsed, "browser-executable-path");

  if (!url) {
    throw new Error("login requires --url or --invite-url");
  }

  await fs.mkdir(path.dirname(stateFile), { recursive: true });

  const browser = await chromium.launch({
    ...(browserExecutablePath
      ? { executablePath: path.resolve(process.cwd(), browserExecutablePath) }
      : { channel: browserChannel }),
    headless: false,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log("Finish login in the browser, then press Enter here to save local session state.");

  const terminal = readline.createInterface({ input, output });
  try {
    await terminal.question("");
  } finally {
    terminal.close();
  }

  await context.storageState({ path: stateFile });
  await browser.close();

  console.log(`Saved local Playwright session state to ${stateFile}`);
}

async function runStress(parsed: ParsedArgs): Promise<void> {
  const concurrency = parsePositiveInteger(
    getSingleFlag(parsed, "concurrency"),
    DEFAULT_CONCURRENCY,
  );
  const requestCount = parsePositiveInteger(
    getSingleFlag(parsed, "requests"),
    DEFAULT_REQUESTS,
  );
  const timeoutMs = parsePositiveInteger(
    getSingleFlag(parsed, "timeout-ms"),
    DEFAULT_TIMEOUT_MS,
  );
  const stateFile = resolveStateFile(getSingleFlag(parsed, "state-file"));
  const requests = await resolveRequests(parsed);
  const useStoredState = !hasFlag(parsed, "public-only");
  const stateFileExists = useStoredState ? await fileExists(stateFile) : false;

  if (requests.length === 0) {
    throw new Error("run requires at least one request target via --invite-url, --url, or --request-file");
  }

  if (useStoredState && !stateFileExists) {
    console.log(`No local session state found at ${stateFile}; running requests without saved auth state.`);
  }

  console.log(
    `Running ${requestCount} requests across ${requests.length} target(s) with concurrency ${concurrency}.`,
  );

  const queue = Array.from({ length: requestCount }, (_, index) => requests[index % requests.length]);
  const results: RequestSample[] = [];
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const apiContext = await request.newContext({
        ignoreHTTPSErrors: false,
        storageState: useStoredState && stateFileExists ? stateFile : undefined,
      });

      try {
        while (nextIndex < queue.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          const sample = await executeRequest(apiContext, queue[currentIndex]!, timeoutMs);
          results.push(sample);
        }
      } finally {
        await apiContext.dispose();
      }
    }),
  );

  printSummary(results);
}

type RequestSample = {
  durationMs: number;
  error?: string;
  label: string;
  method: HttpMethod;
  status: number;
  url: string;
};

async function executeRequest(
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
  target: StressRequest,
  timeoutMs: number,
): Promise<RequestSample> {
  const startedAt = performance.now();

  try {
    const response = await apiContext.fetch(target.url, {
      data: target.body,
      failOnStatusCode: false,
      headers: target.headers,
      method: target.method,
      timeout: timeoutMs,
    });

    return {
      durationMs: performance.now() - startedAt,
      label: target.label ?? `${target.method} ${target.url}`,
      method: target.method,
      status: response.status(),
      url: target.url,
    };
  } catch (error) {
    return {
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      label: target.label ?? `${target.method} ${target.url}`,
      method: target.method,
      status: 0,
      url: target.url,
    };
  }
}

async function resolveRequests(parsed: ParsedArgs): Promise<StressRequest[]> {
  const explicitUrls = getFlagValues(parsed, "url").map((url) => ({
    label: `GET ${url}`,
    method: "GET" as const,
    url,
  }));
  const inviteRequests = resolveInviteRequests(getSingleFlag(parsed, "invite-url"));
  const requestFilePath = getSingleFlag(parsed, "request-file");

  if (!requestFilePath) {
    return [...inviteRequests, ...explicitUrls];
  }

  const requestFile = path.resolve(process.cwd(), requestFilePath);
  const rawFile = await fs.readFile(requestFile, "utf8");
  const parsedFile = JSON.parse(rawFile) as
    | StressRequest[]
    | { requests?: StressRequest[] };
  const fileRequests = Array.isArray(parsedFile) ? parsedFile : parsedFile.requests ?? [];

  return [...inviteRequests, ...explicitUrls, ...fileRequests.map(normalizeRequest)];
}

function normalizeRequest(requestInput: StressRequest): StressRequest {
  return {
    body: requestInput.body,
    headers: requestInput.headers,
    label: requestInput.label,
    method: normalizeMethod(requestInput.method),
    url: requestInput.url,
  };
}

function resolveInviteRequests(inviteUrl: string | undefined): StressRequest[] {
  if (!inviteUrl) {
    return [];
  }

  const parsed = new URL(inviteUrl);
  const inviteCode = parsed.pathname.split("/").filter(Boolean).at(-1);

  if (!inviteCode) {
    throw new Error(`Could not infer invite code from ${inviteUrl}`);
  }

  return [
    {
      label: `GET ${parsed.toString()}`,
      method: "GET",
      url: parsed.toString(),
    },
    {
      label: `GET invite status ${inviteCode}`,
      method: "GET",
      url: new URL(`/api/hosted-onboarding/invites/${inviteCode}/status`, parsed.origin).toString(),
    },
  ];
}

function normalizeMethod(value: string | undefined): HttpMethod {
  const normalized = (value ?? "GET").toUpperCase();

  if (
    normalized === "GET" ||
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  ) {
    return normalized;
  }

  throw new Error(`Unsupported HTTP method: ${value}`);
}

function parseArgs(args: string[]): ParsedArgs {
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const trimmed = token.slice(2);
    const [name, inlineValue] = trimmed.split("=", 2);

    if (!name) {
      continue;
    }

    if (inlineValue !== undefined) {
      appendFlag(flags, name, inlineValue);
      continue;
    }

    const nextToken = args[index + 1];

    if (!nextToken || nextToken.startsWith("--")) {
      appendFlag(flags, name, "true");
      continue;
    }

    appendFlag(flags, name, nextToken);
    index += 1;
  }

  return { flags, positionals };
}

function appendFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const existing = flags.get(name);

  if (existing) {
    existing.push(value);
    return;
  }

  flags.set(name, [value]);
}

function getFlagValues(parsed: ParsedArgs, name: string): string[] {
  return parsed.flags.get(name) ?? [];
}

function getSingleFlag(parsed: ParsedArgs, name: string): string | undefined {
  return getFlagValues(parsed, name).at(-1);
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }

  return parsed;
}

function resolveStateFile(value: string | undefined): string {
  return value ? path.resolve(process.cwd(), value) : DEFAULT_STATE_FILE;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function printSummary(results: RequestSample[]): void {
  const statusCounts = new Map<string, number>();
  const durations = results.map((result) => result.durationMs).sort((left, right) => left - right);
  let totalDuration = 0;

  for (const result of results) {
    totalDuration += result.durationMs;
    const key = result.error ? `error:${result.error}` : `status:${result.status}`;
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
  }

  const average = totalDuration / results.length;
  const minimum = durations[0] ?? 0;
  const maximum = durations.at(-1) ?? 0;
  const p95 = durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? 0;

  console.log("");
  console.log("Result counts:");
  for (const [key, count] of [...statusCounts.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    console.log(`- ${key}: ${count}`);
  }
  console.log("");
  console.log(`avg_ms=${average.toFixed(1)}`);
  console.log(`min_ms=${minimum.toFixed(1)}`);
  console.log(`p95_ms=${p95.toFixed(1)}`);
  console.log(`max_ms=${maximum.toFixed(1)}`);
}

function printUsage(): void {
  console.log(`Usage:
  pnpm --dir apps/web stress:playwright -- login --url <page-url> [--state-file <path>] [--browser-channel chrome] [--browser-executable-path <path>]
  pnpm --dir apps/web stress:playwright -- run [--invite-url <join-url>] [--url <request-url> ...] [--request-file <json>] [--state-file <path>] [--public-only] [--requests 50] [--concurrency 8] [--timeout-ms 15000]

Examples:
  pnpm --dir apps/web stress:playwright -- login --invite-url ${DEFAULT_BASE_URL}/join/INVITE_CODE
  pnpm --dir apps/web stress:playwright -- login --invite-url ${DEFAULT_BASE_URL}/join/INVITE_CODE --browser-executable-path "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  pnpm --dir apps/web stress:playwright -- run --invite-url ${DEFAULT_BASE_URL}/join/INVITE_CODE --requests 150 --concurrency 25
  pnpm --dir apps/web stress:playwright -- run --request-file ./local-stress-requests.json --requests 100 --concurrency 10

Request file shape:
  {
    "requests": [
      { "url": "https://www.withmurph.ai/api/hosted-onboarding/invites/INVITE/status", "method": "GET", "label": "invite-status" }
    ]
  }
`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

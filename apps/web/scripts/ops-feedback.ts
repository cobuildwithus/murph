import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type APIRequestContext } from "@playwright/test";

const ORIGIN = "https://www.withmurph.ai";
const ENDPOINT = `${ORIGIN}/api/ops/feedback`;
const HELP = `Usage: scripts/ops-feedback <command> [options]

  login                         Sign in using a dedicated local browser session
  list [--after CURSOR]          List one page of de-identified feedback
  request --feedback-id ID --question TEXT --idempotency-key KEY
                                Submit one read-only diagnostic
  results --feedback-id ID [--after CURSOR]
                                Read one page of diagnostic status and answers

Output is JSON. Reuse the same idempotency key when retrying a request.
Only authenticated, allowlisted Ops accounts can access the API.
The local browser profile stays outside the repository. Never share it.
`;

export type FeedbackCommand = {
  command: "list" | "request" | "results";
  url: string;
  body?: { feedbackId: string; question: string; idempotencyKey: string };
} | { command: "login" } | { command: "help" };

export class FeedbackCliError extends Error {}

export function parseFeedbackCommand(args: string[]): FeedbackCommand {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {
      "feedback-id": { type: "string" }, question: { type: "string" },
      "idempotency-key": { type: "string" }, after: { type: "string" },
      help: { type: "boolean", short: "h" },
    } });
  } catch {
    throw new FeedbackCliError("Invalid arguments. Run scripts/ops-feedback --help.");
  }
  if (parsed.values.help || parsed.positionals.length === 0) return { command: "help" };
  const [command] = parsed.positionals;
  const allowed: Record<string, readonly string[]> = {
    login: [], list: ["after"], results: ["feedback-id", "after"],
    request: ["feedback-id", "question", "idempotency-key"],
  };
  if (parsed.positionals.length !== 1 || !command || !Object.hasOwn(allowed, command)
    || Object.keys(parsed.values).some((key) => !allowed[command]?.includes(key))) {
    throw new FeedbackCliError("Invalid command options. Run scripts/ops-feedback --help.");
  }
  if (command === "login") return { command };
  const url = new URL(ENDPOINT);
  if (command === "request") return { command, url: url.href, body: {
    feedbackId: boundedText(parsed.values["feedback-id"], 256),
    question: boundedText(parsed.values.question, 1200),
    idempotencyKey: boundedText(parsed.values["idempotency-key"], 256),
  } };
  if (command === "results") url.searchParams.set("feedbackId", boundedText(parsed.values["feedback-id"], 256));
  if (parsed.values.after !== undefined) url.searchParams.set("after", boundedText(parsed.values.after, 256));
  return { command: command === "results" ? "results" : "list", url: url.href };
}

function boundedText(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > limit) {
    throw new FeedbackCliError("Missing or oversized argument. Use a feedback id, a question up to 1200 characters, and a stable idempotency key.");
  }
  return value.trim();
}

export async function executeFeedbackRequest(
  request: Pick<APIRequestContext, "fetch">,
  command: Extract<FeedbackCommand, { url: string }>,
): Promise<unknown> {
  // The CLI never accepts an endpoint, headers or credentials from an agent.
  const target = new URL(command.url);
  if (target.origin !== ORIGIN || target.pathname !== "/api/ops/feedback") {
    throw new FeedbackCliError("Feedback requests must use the canonical Ops endpoint.");
  }
  const response = await request.fetch(command.url, {
    method: command.body ? "POST" : "GET",
    ...(command.body ? { data: command.body } : {}),
    headers: { Origin: ORIGIN, Accept: "application/json" },
    maxRedirects: 0, maxRetries: 0, timeout: 30_000, failOnStatusCode: false,
  });
  try {
    if (response.status() === 401) throw new FeedbackCliError("Sign in first: scripts/ops-feedback login");
    if (response.status() === 404) throw new FeedbackCliError("Ops access is unavailable. The signed-in account must be on the server Ops allowlist and the feedback API must be deployed.");
    if (!response.ok()) throw new FeedbackCliError(`Feedback API rejected the request (HTTP ${response.status()}). No redirect or retry was attempted.`);
    const body = await response.body();
    if (body.length > 1024 * 1024) throw new FeedbackCliError("Feedback response exceeded the bounded page size.");
    return JSON.parse(body.toString("utf8"));
  } finally {
    await response.dispose();
  }
}

export async function prepareFeedbackProfile(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (process.getuid && stat.uid !== process.getuid())) {
    throw new FeedbackCliError("The local Ops browser profile must be a directory owned by this account.");
  }
  await chmod(directory, 0o700);
}

async function run(): Promise<void> {
  const command = parseFeedbackCommand(process.argv.slice(2));
  if (command.command === "help") { process.stdout.write(HELP); return; }
  const directory = join(homedir(), ".local", "state", "murph", "ops-feedback-browser");
  await prepareFeedbackProfile(directory);
  const context = await chromium.launchPersistentContext(directory, {
    headless: command.command !== "login",
    acceptDownloads: false,
  });
  try {
    if (command.command === "login") {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(`${ORIGIN}/ops/tasks`);
      process.stderr.write("Sign in with your Ops account in the browser window. Waiting up to 10 minutes.\n");
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        const response = await context.request.get(ENDPOINT, { maxRedirects: 0, timeout: 10_000 });
        const authenticated = response.ok();
        await response.dispose();
        if (authenticated) { process.stdout.write('{"authenticated":true}\n'); return; }
        await delay(10_000);
      }
      throw new FeedbackCliError("Sign-in timed out. The account must have active Ops access.");
    }
    const result = await executeFeedbackRequest(context.request, command);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    // Browser errors can contain local paths and request metadata; never print them.
    process.stderr.write(`${JSON.stringify({ error: error instanceof FeedbackCliError
      ? error.message : "Local Ops request failed. Close other uses of this tool, check the network and installed Playwright browser, then retry with the same idempotency key." })}\n`);
    process.exitCode = 1;
  });
}

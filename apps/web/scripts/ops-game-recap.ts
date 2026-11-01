import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type APIRequestContext } from "@playwright/test";
import { prepareFeedbackProfile } from "./ops-feedback";

const ORIGIN = "https://www.withmurph.ai";
const HELP = `Usage: scripts/ops-game-recap --game-id ID --regeneration-id ID [--execute]

Dry run is the default. Execute reserves one new recap turn and normal group
message with its recap link. The old story stays visible until replacement is
accepted. Reuse the same regeneration id on retries, including after completion.
A different id deliberately requests another regeneration.
Sign in first with scripts/ops-feedback login (the existing Ops browser session).
Only authenticated, allowlisted operators can trigger this action.
`;

export function parseGameRecapCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    "game-id": { type: "string" }, "regeneration-id": { type: "string" }, execute: { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) return null;
  if (positionals.length || !/^[A-Za-z0-9_-]{8,64}$/u.test(values["game-id"] ?? "")
    || !/^[A-Za-z0-9_-]{8,32}$/u.test(values["regeneration-id"] ?? "")) throw new Error("Invalid arguments.");
  return { gameId: values["game-id"]!, regenerationId: values["regeneration-id"]!, execute: values.execute === true };
}

export async function executeGameRecapRequest(request: Pick<APIRequestContext, "fetch">, body: NonNullable<ReturnType<typeof parseGameRecapCommand>>) {
  const response = await request.fetch(`${ORIGIN}/api/ops/game-recap`, {
    method: "POST", data: body, headers: { Origin: ORIGIN, Accept: "application/json" },
    maxRedirects: 0, maxRetries: 0, timeout: 30_000, failOnStatusCode: false,
  });
  try {
    if (!response.ok()) throw new Error("Ops request rejected.");
    const bytes = await response.body();
    if (bytes.length > 4096) throw new Error("Ops response too large.");
    // Print only this operation's metadata, never arbitrary server response text.
    const result = JSON.parse(bytes.toString("utf8"));
    const outcomes = ["reserved", "would_regenerate", "already_requested", "ineligible_roster", "not_settled", "player_departed",
      "game_disabled", "chat_unavailable", "players_blocked", "recap_unavailable", "delivery_pending", "delivery_unavailable"];
    if (!outcomes.includes(result.outcome)) throw new Error("Unexpected Ops response.");
    return { gameId: body.gameId, regenerationId: body.regenerationId, dryRun: !body.execute, outcome: result.outcome,
      ...(result.outcome === "would_regenerate" ? { would: ["run_hosted_read_game_and_write_recap", "replace_old_recap_only_after_acceptance", "send_recap_message_and_link_to_existing_game_group"] } : {}) };
  } finally { await response.dispose(); }
}

async function run() {
  const command = parseGameRecapCommand(process.argv.slice(2));
  if (!command) { process.stdout.write(HELP); return; }
  const directory = join(homedir(), ".local", "state", "murph", "ops-feedback-browser");
  await prepareFeedbackProfile(directory);
  const context = await chromium.launchPersistentContext(directory, { headless: true, acceptDownloads: false });
  try { process.stdout.write(`${JSON.stringify(await executeGameRecapRequest(context.request, command))}\n`); }
  finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    process.stderr.write('Ops recap request failed. Check --help, sign in with scripts/ops-feedback login, and retry with the same regeneration id.\n');
    process.exitCode = 1;
  });
}

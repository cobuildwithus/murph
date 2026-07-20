import {
  cleanupStaleTestTempRoots,
  MURPH_VITEST_TEMP_STALE_MS,
} from "../config/vitest-temp-lifecycle.js";

function usage(): never {
  process.stderr.write("Usage: pnpm exec tsx scripts/cleanup-test-temp.ts [--apply] [--older-than-hours <hours>]\n");
  process.exit(2);
}

let apply = false;
let staleAfterMs = MURPH_VITEST_TEMP_STALE_MS;
const args = process.argv.slice(2);
while (args.length > 0) {
  const argument = args.shift();
  if (argument === "--apply") {
    apply = true;
    continue;
  }
  if (argument === "--older-than-hours") {
    const value = args.shift();
    if (!value || !/^\d+(?:\.\d+)?$/u.test(value) || Number(value) <= 0) usage();
    staleAfterMs = Number(value) * 60 * 60 * 1000;
    continue;
  }
  usage();
}

const result = await cleanupStaleTestTempRoots({ apply, staleAfterMs });
const counts = new Map<string, number>();
for (const decision of result.decisions) {
  const key = `${decision.action}:${decision.reason}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const summary = [...counts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, count]) => `${key}=${count}`)
  .join(" ");
process.stdout.write(
  `test-temp cleanup: mode=${apply ? "apply" : "dry-run"} candidates=${result.decisions.length} unmarked=${result.ignoredUnmarked}${summary ? ` ${summary}` : ""}\n`,
);

import { fork } from "node:child_process";
import { once } from "node:events";
import { check, outcomes, safeCounts, stages } from "./policy.ts";

export type Summary = { stage: string; outcome: string; counts: Record<string, number> };

// Never forward stdio or serialize errors from Chromium, Web, assertions or the runtime test runner.
export async function privatePhase(entry: URL, cwd: string, env: Record<string, string | undefined>, phase: string, deadline: number, summary: Summary, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = fork(entry, [], { cwd, env: { ...env, NODE_ENV: "test" }, execArgv: ["--conditions=react-server", "--import", "tsx"],
    stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const stop = () => { child.kill(); };
  signal?.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(stop, Math.max(1, deadline - Date.now()));
  let finished = false;
  child.on("message", (event: Partial<Summary>) => {
    if (event?.stage && stages.includes(event.stage)) summary.stage = event.stage;
    if (event?.counts) summary.counts = safeCounts(event.counts);
    if (event?.outcome && outcomes.includes(event.outcome)) { summary.outcome = event.outcome; finished = true; }
  });
  try {
    const exited = once(child, "exit");
    child.send({ phase });
    const [code] = await exited;
    check(code === 0 && finished && summary.outcome === "pass");
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", stop); }
}

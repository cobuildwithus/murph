import { sleep } from "workflow";
import { processHostedLinqTerminalRetryStep } from "./linq-terminal-retry-workflow-step";

export async function hostedLinqTerminalRetryWorkflow(input: { messageRowId: string }): Promise<void> {
  "use workflow";
  // Even a prolonged database outage cannot create an unbounded workflow.
  for (let pass = 0; pass < 40; pass += 1) {
    let next: Date | null;
    try {
      next = await processHostedLinqTerminalRetryStep(input);
    } catch {
      // A committed dispatch claim remains closed on replay. Only reads and
      // pre-dispatch work can resume; the row independently fences expiry.
      await sleep("5s");
      continue;
    }
    if (!next) return;
    await sleep(new Date(Math.max(next.getTime(), Date.now() + 5_000)));
  }
}

import { getPrisma } from "../prisma";
import { processHostedLinqTerminalRetry } from "./linq-terminal-retry";
import { withHostedWorkflowStepMaxRetries } from "./workflow-step-options";

export async function processHostedLinqTerminalRetryStep(input: { messageRowId: string }): Promise<Date | null> {
  "use step";
  try {
    return await processHostedLinqTerminalRetry({ ...input, prisma: getPrisma() });
  } catch {
    // Workflow journals must not retain provider bodies or private context.
    throw new Error("Linq terminal recovery step incomplete.");
  }
}

withHostedWorkflowStepMaxRetries(processHostedLinqTerminalRetryStep, 0);

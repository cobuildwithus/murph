/** A real orchestration + step round trip, with no product or external effects. */
export async function hostedOperationalHeartbeatWorkflow(): Promise<string> {
  "use workflow";
  return await heartbeatStep();
}

async function heartbeatStep(): Promise<string> {
  "use step";
  return "heartbeat-ok";
}

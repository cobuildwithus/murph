import { startHostedRunnerServer } from "./runner-server.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

await startHostedRunnerServer({
  controlToken: process.env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN ?? null,
  port,
});

await new Promise(() => {});

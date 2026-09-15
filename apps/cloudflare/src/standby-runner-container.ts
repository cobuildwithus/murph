import { readHostedRunnerDeployment } from "./hosted-runner-release.ts";
import {
  registerHostedRunnerContainerOutboundInterception,
  RunnerContainer,
} from "./runner-container.js";

/** Legacy namespace drain only. All lifecycle and binding ownership is in RunnerContainer. */
export class StandbyRunnerContainer extends RunnerContainer {
  protected override readonly slotNamespace = "standby" as const;
}

registerHostedRunnerContainerOutboundInterception(StandbyRunnerContainer);

/** Retained namespace only; the base class rejects fresh preparation and binding. */
export class SmallRunnerContainer extends RunnerContainer {
  protected override readonly slotNamespace = "small" as const;

  constructor(state: unknown, env: Readonly<Record<string, unknown>>) {
    super(state, env, readHostedRunnerDeployment(env)?.active.bank ?? "primary");
  }
}

registerHostedRunnerContainerOutboundInterception(SmallRunnerContainer);

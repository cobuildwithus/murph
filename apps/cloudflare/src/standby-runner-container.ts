import { HOSTED_RUNNER_OUTBOUND_BY_HOST } from "./runner-egress-intercept.ts";
import { readHostedRunnerDeployment } from "./hosted-runner-release.ts";
import {
  RunnerContainer,
} from "./runner-container.js";

/** Legacy namespace drain only. All lifecycle and binding ownership is in RunnerContainer. */
export class StandbyRunnerContainer extends RunnerContainer {
  protected override readonly slotNamespace = "standby" as const;
}

StandbyRunnerContainer.outboundByHost = HOSTED_RUNNER_OUTBOUND_BY_HOST;

/** Retained namespace only; the base class rejects fresh preparation and binding. */
export class SmallRunnerContainer extends RunnerContainer {
  protected override readonly slotNamespace = "small" as const;

  constructor(state: unknown, env: Readonly<Record<string, unknown>>) {
    super(state, env, readHostedRunnerDeployment(env)?.active.bank ?? "primary");
  }
}

SmallRunnerContainer.outboundByHost = HOSTED_RUNNER_OUTBOUND_BY_HOST;

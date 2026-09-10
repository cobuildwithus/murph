import { readHostedRunnerDeployment } from "./hosted-runner-release.ts";
import {
  registerHostedRunnerContainerOutboundInterception,
  RunnerContainer,
} from "./runner-container.ts";

/** A different allocation shape with the same release and member lifecycle. */
export class SmallRunnerContainer extends RunnerContainer {
  protected override readonly slotNamespace = "small" as const;

  constructor(state: unknown, env: Readonly<Record<string, unknown>>) {
    super(state, env, readHostedRunnerDeployment(env)?.active.bank ?? "primary");
  }
}

registerHostedRunnerContainerOutboundInterception(SmallRunnerContainer);

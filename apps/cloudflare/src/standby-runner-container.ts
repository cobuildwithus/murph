import {
  registerHostedRunnerContainerOutboundInterception,
  RunnerContainer,
} from "./runner-container.js";

/** Legacy namespace drain only. All lifecycle and binding ownership is in RunnerContainer. */
export class StandbyRunnerContainer extends RunnerContainer {
  protected override readonly slotNamespace = "standby" as const;
}

registerHostedRunnerContainerOutboundInterception(StandbyRunnerContainer);

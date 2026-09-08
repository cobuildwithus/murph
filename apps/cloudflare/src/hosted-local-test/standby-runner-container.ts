import {
  registerHostedRunnerContainerOutboundInterception,
} from "../runner-container.ts";
import {
  StandbyRunnerContainer,
} from "../standby-runner-container.ts";
export class HostedLocalTestStandbyRunnerContainer extends StandbyRunnerContainer {
  async beginShutdownCheckpointGracefulStopForTest(
    _input: { userId: string },
  ): Promise<{ ok: true }> {
    await this.stop("SIGTERM");
    return { ok: true };
  }
}

registerHostedRunnerContainerOutboundInterception(
  HostedLocalTestStandbyRunnerContainer,
);

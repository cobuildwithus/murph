import { HOSTED_RUNNER_OUTBOUND_BY_HOST } from "../runner-egress-intercept.ts";
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

HostedLocalTestStandbyRunnerContainer.outboundByHost = HOSTED_RUNNER_OUTBOUND_BY_HOST;

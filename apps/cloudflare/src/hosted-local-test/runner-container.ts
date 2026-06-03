import {
  RunnerContainer as BaseRunnerContainer,
} from "../runner-container.ts";
import {
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "../runner-egress-intercept.ts";

export class RunnerContainer extends BaseRunnerContainer {
  async expireActivityForTest(_input: { userId: string }): Promise<{ ok: true }> {
    await this.onActivityExpired();
    return { ok: true };
  }
}

RunnerContainer.outboundByHost = HOSTED_RUNNER_OUTBOUND_BY_HOST;

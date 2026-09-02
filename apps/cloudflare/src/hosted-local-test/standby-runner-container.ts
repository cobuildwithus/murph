import {
  registerHostedRunnerContainerOutboundInterception,
} from "../runner-container.ts";
import {
  StandbyRunnerContainer,
} from "../standby-runner-container.ts";
import {
  HOSTED_STANDBY_REGION,
} from "../standby-runner-contract.ts";

const HOSTED_LOCAL_STANDBY_REGION = "REGN";

export class HostedLocalTestStandbyRunnerContainer extends StandbyRunnerContainer {
  protected override resolveExpectedStandbyHealthRegion(
    _region: typeof HOSTED_STANDBY_REGION,
  ): string {
    // Wrangler local cannot reproduce Cloudflare's production ENAM placement
    // metadata. The production class continues to require the real region.
    return HOSTED_LOCAL_STANDBY_REGION;
  }
}

registerHostedRunnerContainerOutboundInterception(
  HostedLocalTestStandbyRunnerContainer,
);

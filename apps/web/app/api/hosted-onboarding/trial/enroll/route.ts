// Rolling-deploy bridge for browser bundles that still call the former trial
// endpoint. Remove after every pre-starter Web deployment and cached client has
// drained; the implementation and entitlement are fully starter-usage owned.
export { POST } from "../../starter/enroll/route";

import "server-only";

import {
  type HostedAppSession,
} from "../hosted-onboarding/app-session";
import { requireHostedOpsPageAccess } from "../hosted-ops/access";

export async function requireHostedRuntimeLatencyOpsAccess(): Promise<HostedAppSession> {
  return requireHostedOpsPageAccess();
}

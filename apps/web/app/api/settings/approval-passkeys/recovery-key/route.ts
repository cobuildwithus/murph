import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { approvalRecoveryRequest } from "@/src/lib/sensitive-actions/passkey-recovery-request";
export const POST = withJsonError((request: Request) => approvalRecoveryRequest(request, "rotate"));

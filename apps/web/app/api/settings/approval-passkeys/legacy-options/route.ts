import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { legacyApprovalRepairRequest } from "@/src/lib/sensitive-actions/legacy-passkey-repair-request";

export const POST = withJsonError((request: Request) => legacyApprovalRepairRequest(request, "options"));

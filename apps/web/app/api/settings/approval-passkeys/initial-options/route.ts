import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { initialApprovalEnrollmentRequest } from "@/src/lib/sensitive-actions/initial-passkey-enrollment-request";

export const POST = withJsonError((request: Request) => initialApprovalEnrollmentRequest(request, "options"));

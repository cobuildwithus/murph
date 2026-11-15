import { ContractValidationError } from "@murphai/contracts/validation-error";
import { readJsonObject } from "./http";

export async function requireHostedInviteCodeFromRequest(
  request: Request,
): Promise<{
  inviteCode: string;
  body: Record<string, unknown>;
}> {
  const body = await readJsonObject(request);
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;

  if (!inviteCode) {
    throw new ContractValidationError("inviteCode is required.");
  }

  return {
    body,
    inviteCode,
  };
}

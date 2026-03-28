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
    throw new TypeError("inviteCode is required.");
  }

  return {
    body,
    inviteCode,
  };
}

import { attachHostedSessionCookie } from "./service";
import { jsonOk, readJsonObject } from "./http";

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

export function createHostedStageSessionResponse(input: {
  expiresAt: Date;
  stage: string;
  token: string;
}) {
  const response = jsonOk({
    ok: true,
    stage: input.stage,
  });

  attachHostedSessionCookie({
    expiresAt: input.expiresAt,
    response,
    token: input.token,
  });

  return response;
}

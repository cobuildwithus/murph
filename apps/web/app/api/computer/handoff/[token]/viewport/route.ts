import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  isComputerBrowserViewportPreset,
} from "@/src/lib/computer-use/viewport";
import {
  requireActiveHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const token = await resolveDecodedRouteParam(context.params, "token");
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const payload = await request.json().catch(() => null);
  const preset = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).preset
    : null;

  if (!isComputerBrowserViewportPreset(preset)) {
    return Response.json({ error: "Invalid viewport preset." }, { status: 400 });
  }

  const service = createComputerUseService();
  await service.ensureHandoffViewport({
    memberId: session.member.id,
    preset,
    token,
  });

  return new Response(null, { status: 204 });
}

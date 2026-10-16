import { requireGameMember } from "@/src/lib/game/http/auth";
import { serveGameMedia } from "@/src/lib/game/http/media-routes";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { InvalidRouteParamEncodingError } from "@/src/lib/http";

// Accepts the key either percent-encoded in one segment or as plain path segments.
export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) => {
  const memberId = await requireGameMember(request);
  const { key } = await context.params;
  return serveGameMedia({ key: key.map(decodeSegment).join("/"), memberId });
});

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new InvalidRouteParamEncodingError("key");
  }
}

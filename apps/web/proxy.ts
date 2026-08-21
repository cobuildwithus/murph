import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  acceptsMarkdown,
  MURPH_AGENT_CONTENT_VARY,
  MURPH_AGENT_GUIDE_MARKDOWN,
} from "@/src/lib/public-agent-content";

const WORKFLOW_WEBHOOK_ROUTE_PREFIX = "/.well-known/workflow/v1/webhook/";
const PUBLIC_HOMEPAGE_PATH = "/";

export const config = {
  matcher: ["/", "/.well-known/workflow/v1/webhook/:path*"],
};

export function proxy(request: NextRequest): NextResponse {
  const malformedWebhookResponse = rejectMalformedWorkflowWebhookToken(
    request.nextUrl.pathname,
  );
  if (malformedWebhookResponse) {
    return malformedWebhookResponse;
  }

  if (request.nextUrl.pathname !== PUBLIC_HOMEPAGE_PATH) {
    return NextResponse.next();
  }

  if (
    (request.method === "GET" || request.method === "HEAD")
    && acceptsMarkdown(request.headers.get("accept"))
  ) {
    return new NextResponse(
      request.method === "HEAD" ? null : MURPH_AGENT_GUIDE_MARKDOWN,
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          "Content-Type": "text/markdown; charset=utf-8",
          Vary: MURPH_AGENT_CONTENT_VARY,
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("Vary", MURPH_AGENT_CONTENT_VARY);
  return response;
}

export function rejectMalformedWorkflowWebhookToken(pathname: string): NextResponse | null {
  if (!pathname.startsWith(WORKFLOW_WEBHOOK_ROUTE_PREFIX)) {
    return null;
  }

  const tokenSegment = pathname.slice(WORKFLOW_WEBHOOK_ROUTE_PREFIX.length).split("/")[0] ?? "";

  try {
    decodeURIComponent(tokenSegment);
  } catch {
    return new NextResponse("Malformed token", { status: 400 });
  }

  return null;
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const WORKFLOW_WEBHOOK_ROUTE_PREFIX = "/.well-known/workflow/v1/webhook/";

export const config = {
  matcher: "/.well-known/workflow/v1/webhook/:path*",
};

export function proxy(request: NextRequest): NextResponse {
  return rejectMalformedWorkflowWebhookToken(request.nextUrl.pathname) ?? NextResponse.next();
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

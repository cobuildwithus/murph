import { NextResponse } from "next/server";

import { disconnectDeviceAccount } from "../../../../../src/lib/device-sync";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;

  await disconnectDeviceAccount({
    accountId,
  });

  return NextResponse.redirect(resolveReturnTo(request));
}

function resolveReturnTo(request: Request): URL {
  const requestUrl = new URL(request.url);
  const candidate = requestUrl.searchParams.get("returnTo");
  const pathname = candidate && candidate.startsWith("/") ? candidate : "/";
  return new URL(pathname, requestUrl.origin);
}

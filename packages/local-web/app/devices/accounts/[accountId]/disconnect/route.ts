import { NextResponse } from "next/server";

import {
  buildWebReturnTo,
  disconnectDeviceAccount,
} from "../../../../../src/lib/device-sync";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;

  await disconnectDeviceAccount({
    accountId,
  });

  return NextResponse.redirect(buildWebReturnTo(new URL(request.url)));
}

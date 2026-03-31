import { NextResponse } from "next/server";

import {
  buildWebReturnTo,
  reconcileDeviceAccount,
} from "../../../../../src/lib/device-sync";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;

  await reconcileDeviceAccount({
    accountId,
  });

  return NextResponse.redirect(buildWebReturnTo(new URL(request.url)));
}

import { NextResponse } from "next/server";

import {
  beginDeviceConnection,
  buildWebReturnTo,
  isDeviceSyncWebError,
} from "../../../../src/lib/device-sync";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const requestUrl = new URL(request.url);

  try {
    const connection = await beginDeviceConnection({
      provider,
      returnTo: buildWebReturnTo(requestUrl),
    });

    return NextResponse.redirect(connection.authorizationUrl);
  } catch (error) {
    if (isDeviceSyncWebError(error) && error.code === "RETURN_TO_INVALID") {
      const connection = await beginDeviceConnection({
        provider,
      });

      return NextResponse.redirect(connection.authorizationUrl);
    }

    throw error;
  }
}

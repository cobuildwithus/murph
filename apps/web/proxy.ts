import { NextResponse, type NextRequest } from "next/server";

import {
  HOSTED_PHONE_COUNTRY_CODE_COOKIE_MAX_AGE_SECONDS,
  HOSTED_PHONE_COUNTRY_CODE_COOKIE_NAME,
  HOSTED_PHONE_COUNTRY_CODE_REQUEST_HEADER,
  readHostedPhoneCountryCodeFromCookieStore,
  resolveHostedPhoneCountryCodeFromVercelHeaders,
} from "./src/lib/hosted-onboarding/phone-country-hint";

export function proxy(request: NextRequest) {
  const phoneCountryCode = resolveHostedPhoneCountryCodeFromVercelHeaders(
    request.headers,
  );
  const requestHeaders = new Headers(request.headers);

  if (phoneCountryCode) {
    requestHeaders.set(HOSTED_PHONE_COUNTRY_CODE_REQUEST_HEADER, phoneCountryCode);
  } else {
    requestHeaders.delete(HOSTED_PHONE_COUNTRY_CODE_REQUEST_HEADER);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  const currentCookieCountryCode = readHostedPhoneCountryCodeFromCookieStore(
    request.cookies,
  );

  if (phoneCountryCode && phoneCountryCode !== currentCookieCountryCode) {
    response.cookies.set({
      name: HOSTED_PHONE_COUNTRY_CODE_COOKIE_NAME,
      value: phoneCountryCode,
      httpOnly: true,
      maxAge: HOSTED_PHONE_COUNTRY_CODE_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }

  return response;
}

export const config = {
  matcher: ["/", "/join/:path*", "/settings/:path*"],
};

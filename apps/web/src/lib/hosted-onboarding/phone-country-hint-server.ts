import "server-only";

import { cookies, headers } from "next/headers";

import {
  HOSTED_PHONE_COUNTRY_CODE_REQUEST_HEADER,
  normalizeHostedPhoneCountryCode,
  readHostedPhoneCountryCodeFromCookieStore,
} from "./phone-country-hint";

export async function readHostedPhoneCountryCodeHint(): Promise<string | null> {
  const requestHeaders = await headers();
  const forwardedCountryCode = normalizeHostedPhoneCountryCode(
    requestHeaders.get(HOSTED_PHONE_COUNTRY_CODE_REQUEST_HEADER),
  );

  if (forwardedCountryCode) {
    return forwardedCountryCode;
  }

  return readHostedPhoneCountryCodeFromCookieStore(await cookies());
}

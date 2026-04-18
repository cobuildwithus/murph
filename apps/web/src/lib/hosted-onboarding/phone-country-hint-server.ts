import "server-only";

import { headers } from "next/headers";

import {
  readHostedPhoneCountryCodeFromHeaders,
} from "./phone-country-hint";

export async function readHostedPhoneCountryCodeHint(): Promise<string | null> {
  return readHostedPhoneCountryCodeFromHeaders(await headers());
}

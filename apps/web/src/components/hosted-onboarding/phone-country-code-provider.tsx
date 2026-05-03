import type { PropsWithChildren } from "react";

import { readHostedPhoneCountryCodeHint } from "@/src/lib/hosted-onboarding/phone-country-hint-server";

import { HostedPhoneCountryCodeProvider } from "./hosted-phone-country-code-provider";

export async function HostedPhoneCountryCodeBoundary({
  children,
}: PropsWithChildren) {
  const countryCode = await readHostedPhoneCountryCodeHint();

  return (
    <HostedPhoneCountryCodeProvider countryCode={countryCode}>
      {children}
    </HostedPhoneCountryCodeProvider>
  );
}

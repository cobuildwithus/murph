import type { PropsWithChildren } from "react";

import { readHostedPhoneCountryCodeHint } from "@/src/lib/hosted-onboarding/phone-country-hint-server";

import { PhoneCountryCodeClientProvider } from "./phone-country-code-client-provider";

export async function PhoneCountryCodeProvider({
  children,
}: PropsWithChildren) {
  const countryCode = await readHostedPhoneCountryCodeHint();

  return (
    <PhoneCountryCodeClientProvider countryCode={countryCode}>
      {children}
    </PhoneCountryCodeClientProvider>
  );
}

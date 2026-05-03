"use client";

import { createContext, useContext, type PropsWithChildren } from "react";

const HostedPhoneCountryCodeContext = createContext<string | null>(null);

export function PhoneCountryCodeClientProvider({
  children,
  countryCode,
}: PropsWithChildren<{
  countryCode: string | null;
}>) {
  return (
    <HostedPhoneCountryCodeContext.Provider value={countryCode}>
      {children}
    </HostedPhoneCountryCodeContext.Provider>
  );
}

export function usePhoneCountryCode(): string | null {
  return useContext(HostedPhoneCountryCodeContext);
}

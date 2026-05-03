"use client";

import { createContext, useContext, type PropsWithChildren } from "react";

const HostedPhoneCountryCodeContext = createContext<string | null>(null);

export function HostedPhoneCountryCodeProvider({
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

export function useHostedPhoneCountryCodeHint(): string | null {
  return useContext(HostedPhoneCountryCodeContext);
}

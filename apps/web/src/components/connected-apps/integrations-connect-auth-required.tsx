"use client";

import { LinkPageSignIn } from "@/src/components/link-page/link-page-sign-in";

export function IntegrationsConnectAuthRequired() {
  return (
    <LinkPageSignIn
      detail="This link is private to your Murph account."
      title="Sign in to connect your app."
    />
  );
}

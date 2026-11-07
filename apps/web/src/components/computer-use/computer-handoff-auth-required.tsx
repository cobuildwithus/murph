"use client";

import { LinkPageSignIn } from "@/src/components/link-page/link-page-sign-in";

export function ComputerHandoffAuthRequiredState() {
  return (
    <LinkPageSignIn
      detail="This link is private to your Murph account."
      title="Sign in to finish this step."
    />
  );
}

"use client";

import { LinkPageSheet } from "@/src/components/link-page/link-page-sheet";
import { LinkPageSignIn } from "@/src/components/link-page/link-page-sign-in";

export function ActionApprovalAuthRequiredState() {
  return (
    <LinkPageSignIn
      detail="It’s private to the account that received it."
      title="Sign in to review this request."
    >
      <LinkPageSheet locked />
    </LinkPageSignIn>
  );
}

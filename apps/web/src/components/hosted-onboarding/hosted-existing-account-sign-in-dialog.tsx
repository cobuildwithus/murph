"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { HostedPhoneAuth } from "./hosted-phone-auth";

export function HostedExistingAccountSignInDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-sm font-medium text-white underline-offset-4 hover:text-white hover:underline"
        onClick={() => setOpen(true)}
      >
        Already have an account? Sign in
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-stone-900">
              Sign in with your phone
            </DialogTitle>
            <DialogDescription>We&apos;ll text you a sign-in code.</DialogDescription>
          </DialogHeader>
          {open ? (
            <HostedPhoneAuth
              intent="signin"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

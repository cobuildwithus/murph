"use client";

import { useEffect, useState } from "react";

import { MurphContactCardPicker } from "@/src/components/murph/murph-contact-card-picker";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export function HomeInitialVisitContactPickerClient({
  contactAction,
}: {
  contactAction: MurphContactOption | null;
}) {
  const [open, setOpen] = useState(contactAction?.kind === "text");

  useEffect(() => {
    if (open) return;
    // The existing account marker prevents repeat onboarding across surfaces.
    // Failed completion remains pending and can retry on the next Home visit.
    void fetch("/api/settings/initial-onboarding", {
      body: JSON.stringify({ action: "skip" }),
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  }, [open]);

  return open ? (
    <MurphContactCardPicker
      onAddToContacts={() => setOpen(false)}
      onOpenChange={setOpen}
      onSkip={() => setOpen(false)}
      open
    />
  ) : null;
}

"use client";

import { useEffect, useState } from "react";

import { MurphContactCardPicker } from "@/src/components/murph/murph-contact-card-picker";
import { MurphPersonaPicker } from "@/src/components/murph/murph-persona-picker";

const INITIAL_VISIT_QUERY_KEY = "initialVisit";

export function HomeInitialVisitPersonaPickerClient({
  showContactCard,
}: {
  showContactCard: boolean;
}) {
  const [stage, setStage] = useState<"contact" | "persona" | "done">(
    showContactCard ? "contact" : "persona",
  );

  useEffect(() => {
    stripInitialVisitQueryParam();
  }, []);

  if (stage === "contact") {
    return (
      <MurphContactCardPicker
        onAddToContacts={() => setStage("persona")}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setStage("persona");
        }}
        onSkip={() => setStage("persona")}
        open
      />
    );
  }

  if (stage === "persona") {
    return (
      <MurphPersonaPicker
        onComplete={() => setStage("done")}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setStage("done");
        }}
        open
      />
    );
  }

  return null;
}

function stripInitialVisitQueryParam() {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete(INITIAL_VISIT_QUERY_KEY);
  window.history?.replaceState?.({}, "", `${url.pathname}${url.search}${url.hash}`);
}

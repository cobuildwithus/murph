"use client";

import { useEffect, useState } from "react";

import { MurphPersonaPicker } from "@/src/components/murph/murph-persona-picker";

const INITIAL_VISIT_QUERY_KEY = "initialVisit";

export function HomeInitialVisitPersonaPickerClient() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    stripInitialVisitQueryParam();
  }, []);

  return <MurphPersonaPicker onOpenChange={setOpen} open={open} />;
}

function stripInitialVisitQueryParam() {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete(INITIAL_VISIT_QUERY_KEY);
  window.history?.replaceState?.({}, "", `${url.pathname}${url.search}${url.hash}`);
}

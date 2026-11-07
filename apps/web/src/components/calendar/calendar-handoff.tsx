"use client";

import { useEffect } from "react";

import { LINK_PAGE_PILL_CLASS } from "@/src/components/link-page/link-page-shell";

export function CalendarHandoff({
  autoOpen,
  downloadHref,
  payload,
}: {
  autoOpen: boolean;
  downloadHref: string;
  payload: string;
}) {
  useEffect(() => {
    if (!autoOpen) {
      return;
    }
    const key = `murph-calendar-opened:${payload}`;
    if (window.sessionStorage.getItem(key) === "1") {
      return;
    }
    window.sessionStorage.setItem(key, "1");
    window.location.assign(downloadHref);
  }, [autoOpen, downloadHref, payload]);

  return (
    <a className={LINK_PAGE_PILL_CLASS} href={downloadHref}>
      Add to Calendar
    </a>
  );
}

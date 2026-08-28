"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect } from "react";

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
    <div className="grid gap-4 sm:grid-cols-[minmax(220px,280px)_1fr] sm:items-center">
      <a
        className="group flex min-h-13 items-center justify-between bg-[#19231d] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#315a40] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#b8e26f]"
        href={downloadHref}
      >
        Add to Calendar
        <ArrowUpRight
          aria-hidden="true"
          className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        />
      </a>
      <p className="max-w-xs text-xs leading-5 text-[#667168]">
        Apple Calendar will ask you to confirm before anything is added.
      </p>
    </div>
  );
}

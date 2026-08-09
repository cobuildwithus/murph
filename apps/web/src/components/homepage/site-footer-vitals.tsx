"use client";

import { useEffect, useState } from "react";

import {
  resolveStatusPageAvailability,
  STATUS_PAGE_SUMMARY_ENDPOINT,
  STATUS_PAGE_URL,
  type StatusPageAvailability,
} from "@/src/lib/status-page";

import { MessageVolumeCount } from "./message-volume-line";

const AVAILABILITY_PRESENTATION: Record<
  StatusPageAvailability,
  { dotClassName: string; label: string; textClassName: string }
> = {
  unknown: {
    dotClassName: "bg-[#736a58]/50",
    label: "Status",
    textClassName: "text-[#736a58]",
  },
  no_reported_issues: {
    dotClassName: "bg-[#2c7a3f]",
    label: "Murph is online",
    textClassName: "text-[#2c7a3f]",
  },
  issues: {
    dotClassName: "bg-[#a04f30]",
    label: "Murph is having issues",
    textClassName: "text-[#a04f30]",
  },
};

function useStatusPageAvailability(): StatusPageAvailability {
  const [availability, setAvailability] =
    useState<StatusPageAvailability>("unknown");

  useEffect(() => {
    let cancelled = false;
    void fetch(STATUS_PAGE_SUMMARY_ENDPOINT)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (!cancelled) {
          setAvailability(resolveStatusPageAvailability(data));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return availability;
}

export function SiteFooterVitals() {
  const availability = useStatusPageAvailability();
  const presentation = AVAILABILITY_PRESENTATION[availability];

  return (
    <div className="flex flex-col items-start gap-5">
      <div>
        <p className="font-serif text-[2rem] font-semibold leading-none tracking-[-0.02em] text-[#2d3436]">
          <MessageVolumeCount />
        </p>
        <p className="mt-2 text-[0.875rem] text-[#736a58]">
          messages and counting
        </p>
      </div>
      <a
        href={STATUS_PAGE_URL}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-2 py-1 text-[0.875rem] transition-colors hover:underline ${presentation.textClassName}`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${presentation.dotClassName}`}
        />
        {presentation.label}
      </a>
    </div>
  );
}

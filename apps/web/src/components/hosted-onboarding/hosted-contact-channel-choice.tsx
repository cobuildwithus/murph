"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import {
  LINK_PAGE_NIGHT_TOKENS,
  LinkPageLink,
} from "@/src/components/link-page/link-page-shell";

type HostedContactChannel = "phone" | "telegram";

/**
 * "How should Murph reach you": a choice of channel, then that channel's form.
 * Both forms stay mounted, because each loads what it needs before it is shown.
 * A null `telegram` means the phone step owns the screen, so there is no way
 * across until it ends. The join island and the design catalog share this.
 */
export function HostedContactChannelChoice({
  phone,
  telegram,
}: {
  phone: ReactNode;
  telegram: ReactNode;
}) {
  const [channel, setChannel] = useState<HostedContactChannel | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    // The control just used is gone, so focus would otherwise fall to the page.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    regionRef.current?.focus();
  }, [channel]);

  return (
    <div
      className="flex w-full flex-col items-center gap-1 outline-none"
      ref={regionRef}
      style={LINK_PAGE_NIGHT_TOKENS}
      tabIndex={-1}
    >
      {channel === null ? (
        <div className="flex w-full flex-col gap-2.5">
          <HostedContactChannelRow onClick={() => setChannel("phone")}>
            Text message
          </HostedContactChannelRow>
          {telegram ? (
            <HostedContactChannelRow onClick={() => setChannel("telegram")}>
              Telegram
            </HostedContactChannelRow>
          ) : null}
        </div>
      ) : null}

      <div className="w-full" hidden={channel !== "phone"}>{phone}</div>
      <div className="w-full" hidden={channel !== "telegram"}>{telegram}</div>

      {channel === "phone" && telegram ? (
        <LinkPageLink onClick={() => setChannel("telegram")}>
          Use Telegram instead
        </LinkPageLink>
      ) : null}
      {channel === "telegram" ? (
        <LinkPageLink onClick={() => setChannel("phone")}>
          Use a phone number instead
        </LinkPageLink>
      ) : null}
    </div>
  );
}

function HostedContactChannelRow({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-3 rounded-[18px] bg-[#2A2622] p-[18px] text-left text-[17px] font-semibold leading-[22px] text-[#FFFCF6] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#FFFCF6]/70 motion-reduce:transition-none"
      onClick={onClick}
      type="button"
    >
      {children}
      <ChevronRightIcon aria-hidden="true" className="size-5 shrink-0 text-[#FFFCF6]/40" />
    </button>
  );
}

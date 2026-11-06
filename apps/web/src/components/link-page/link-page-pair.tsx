import { CheckIcon } from "lucide-react";
import Image from "next/image";

import { cn } from "@/src/lib/utils";

const LINK_DOTS = [0, 1, 2, 3, 4];

/** Murph and the service being connected, joined by a line of dots. */
export function LinkPagePair({
  joined = false,
  logoSrc,
  name,
}: {
  joined?: boolean;
  logoSrc?: string | null;
  name: string;
}) {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto flex shrink-0 items-center gap-3"
    >
      <span className="flex size-[92px] shrink-0 items-center justify-center rounded-3xl bg-[#2A2622]">
        <Image alt="" className="size-14" height={56} src="/logo-mark.svg" width={56} />
      </span>
      <span className="flex items-center gap-1.5">
        {LINK_DOTS.map((dot) => (
          <span
            className={cn(
              "size-1.5 rounded-full",
              joined ? "bg-[#D9B969]" : "bg-[#FFFCF6]/35",
            )}
            key={dot}
          />
        ))}
      </span>
      <span className="flex size-[92px] shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-[#FFFCF6]">
        {logoSrc ? (
          <Image
            alt=""
            className="h-12 w-[60px] object-contain"
            height={48}
            src={logoSrc}
            width={60}
          />
        ) : (
          <span className="font-serif text-[40px] font-semibold leading-none text-[#2D3436]">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      {joined ? (
        <span
          className="absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-[#1C1915]"
          style={{
            background:
              "linear-gradient(135deg, #EBD18B 0%, #D9B969 55%, #C59D4E 100%)",
          }}
        >
          <CheckIcon className="size-4 text-[#3B2A12]" strokeWidth={3} />
        </span>
      ) : null}
    </div>
  );
}

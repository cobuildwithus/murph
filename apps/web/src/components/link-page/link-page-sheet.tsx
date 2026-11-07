import { LockKeyhole } from "lucide-react";

import { cn } from "@/src/lib/utils";

const SHEET_LINE_WIDTHS = ["100%", "100%", "82%", "100%", "56%"];

/**
 * A sheet of notebook paper, the object on a page about one file. A stamp shows
 * what happened to it; a lock stands in while the name is still private.
 */
export function LinkPageSheet({
  kind = "File",
  locked = false,
  name,
  stamp,
}: {
  kind?: string;
  locked?: boolean;
  name?: string | null;
  stamp?: "Approved" | "Denied";
}) {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto flex h-[268px] w-[208px] shrink-0 flex-col gap-[13px] overflow-hidden rounded-[14px] bg-[#FFFCF6] px-[22px] py-[26px]"
    >
      {name ? (
        <>
          <span className="font-mono text-[11px] uppercase leading-[14px] tracking-[0.16em] text-[#736A58]">
            {kind}
          </span>
          <span className="line-clamp-3 break-words pb-1.5 pr-3 font-serif text-2xl font-semibold leading-7 tracking-[-0.01em] text-[#2D3436]">
            {name}
          </span>
        </>
      ) : null}
      {SHEET_LINE_WIDTHS.map((width, index) => (
        <span
          className="h-1.5 shrink-0 rounded-full bg-[#2D3436]/[0.08]"
          key={index}
          style={{ width }}
        />
      ))}
      <svg
        className="absolute right-0 top-0"
        height="40"
        viewBox="0 0 40 40"
        width="40"
      >
        <path d="M0 0h40v40z" fill="#1C1915" />
        <path d="M0 0v30a10 10 0 0 0 10 10h30z" fill="#E7DFCF" />
      </svg>
      {locked ? (
        <span className="absolute left-1/2 top-1/2 flex size-[60px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#2D3436]">
          <LockKeyhole className="size-6 text-[#FFFCF6]" />
        </span>
      ) : null}
      {stamp ? (
        <span
          className={cn(
            "absolute left-[18px] top-32 -rotate-[10deg] rounded-[10px] border-[3px] bg-[#FFFCF6] px-3.5 py-2 font-mono text-[21px] uppercase leading-[26px] tracking-[0.12em]",
            stamp === "Approved"
              ? "border-[#5A6E32] text-[#5A6E32]"
              : "border-[#8B5D3F] text-[#8B5D3F]",
          )}
        >
          {stamp}
        </span>
      ) : null}
    </div>
  );
}

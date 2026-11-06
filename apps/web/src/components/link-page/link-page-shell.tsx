import Image from "next/image";
import type { ComponentProps, CSSProperties, ReactNode, Ref } from "react";

import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

// A page Murph links to sits on the app's night ground, like a challenge invite.
const LINK_PAGE_PILL_CLASS =
  "flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#FFFCF6] text-[17px] font-semibold text-[#2D3436] transition-[opacity,scale] duration-150 hover:opacity-90 active:scale-[0.98] motion-reduce:transition-none";
const LINK_PAGE_LINK_CLASS =
  "inline-flex h-11 items-center justify-center rounded-lg px-3 text-[15px] font-semibold text-[#FFFCF6] underline-offset-4 hover:underline";
const LINK_PAGE_GOLD =
  "linear-gradient(135deg, #EBD18B 0%, #D9B969 55%, #C59D4E 100%)";

/** A name from outside the page, as a headline that ends in one period. */
function linkPageHeadline(text: string): string {
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

function LinkPageSurface({
  children,
  fit = false,
}: {
  children: ReactNode;
  /** One screen tall, so a long list scrolls inside it and the pill stays in view. */
  fit?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col bg-[#1C1915] text-[#FFFCF6]",
        fit && "min-h-0",
      )}
      data-slot="link-page-surface"
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-[26rem] flex-1 flex-col px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3 sm:my-auto sm:py-12",
          fit ? "min-h-0 sm:max-h-[56rem]" : "sm:flex-none",
        )}
      >
        <div className="flex h-11 shrink-0 items-center">
          <Image
            alt="Murph"
            className="h-[25px] w-auto"
            height={25}
            priority
            src="/logo-dark.svg"
            width={112}
          />
        </div>
        {children}
      </div>
    </div>
  );
}

function LinkPageFrame({
  children,
  fit = false,
}: {
  children: ReactNode;
  fit?: boolean;
}) {
  return (
    <main
      className={cn(
        "flex flex-col bg-[#1C1915]",
        fit ? "h-dvh min-h-[34rem]" : "min-h-dvh",
      )}
    >
      {/* The night ground reaches past the page: overscroll and Safari's bars. */}
      <style>{"html,body{background:#1C1915}"}</style>
      <LinkPageSurface fit={fit}>{children}</LinkPageSurface>
    </main>
  );
}

/** One state of the page: its headline, then what it needs, then its actions. */
function LinkPageScreen({
  actions,
  announceDetail = true,
  below,
  children,
  detail,
  detailRef,
  fill = false,
  headingRef,
  title,
}: {
  actions?: ReactNode;
  /** A state's sentence is announced; a fixed description of the page is not. */
  announceDetail?: boolean;
  /** What belongs with the words, rather than centered in the space below. */
  below?: ReactNode;
  children?: ReactNode;
  detail?: ReactNode;
  detailRef?: Ref<HTMLParagraphElement>;
  /** The children are a list that takes the whole space, not a centered object. */
  fill?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  title: string;
}) {
  return (
    <section
      className={cn("flex flex-1 flex-col", fill && "min-h-0")}
      data-slot="link-page-screen"
    >
      <div className="shrink-0 pt-5">
        <h1
          className="text-balance break-words font-serif text-[40px] font-semibold leading-[44px] tracking-[-0.02em] outline-none"
          ref={headingRef}
          tabIndex={-1}
        >
          {title}
        </h1>
        {detail ? (
          <p
            className="mt-2.5 text-pretty text-base font-medium leading-[22px] text-[#FFFCF6]/60 outline-none"
            ref={detailRef}
            role={announceDetail ? "status" : undefined}
            tabIndex={-1}
          >
            {detail}
          </p>
        ) : null}
        {below}
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col",
          // Enough for a list to stay usable. Past that the page scrolls, so the
          // actions below can never sit on top of a choice.
          fill ? "min-h-[14.5rem] pb-2" : "justify-center py-6",
        )}
      >
        {children}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-col items-center gap-1">
          {actions}
        </div>
      ) : null}
    </section>
  );
}

function LinkPagePill({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(LINK_PAGE_PILL_CLASS, className)}
      size="unstyled"
      type="button"
      variant="unstyled"
      {...props}
    />
  );
}

function LinkPageLink({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(LINK_PAGE_LINK_CLASS, className)}
      size="unstyled"
      type="button"
      variant="unstyled"
      {...props}
    />
  );
}

/** The app's prize ticket: gold, with a quarter circle cut from each corner. */
function LinkPageTicket({
  className,
  kicker,
  note,
  noteId,
  size = "default",
  title,
}: {
  className?: string;
  kicker: string;
  /** The ticket's small print. */
  note?: string;
  noteId?: string;
  size?: "default" | "display" | "large";
  title: string;
}) {
  return (
    <div
      className={cn(
        "relative mt-[26px] flex flex-col gap-1 overflow-hidden px-5 py-[18px]",
        size === "display" && "px-6 py-[26px]",
        className,
      )}
      style={{ background: LINK_PAGE_GOLD }}
    >
      <span className="break-words font-mono text-[10px] uppercase leading-[14px] tracking-[0.2em] text-[#3B2A12]/80">
        {kicker}
      </span>
      <span
        className={cn(
          "font-serif font-semibold text-[#3B2A12]",
          size === "default" && "text-[26px] leading-8",
          size === "large" && "text-[34px] leading-10",
          size === "display" && "text-[44px] leading-[50px]",
        )}
      >
        {title}
      </span>
      {note ? (
        <span
          className="text-sm font-medium leading-[19px] text-[#3B2A12]/80"
          id={noteId}
        >
          {note}
        </span>
      ) : null}
      {[
        "-left-[9px] -top-[9px]",
        "-right-[9px] -top-[9px]",
        "-bottom-[9px] -left-[9px]",
        "-bottom-[9px] -right-[9px]",
      ].map((corner) => (
        <span
          aria-hidden="true"
          className={cn("absolute size-[18px] rounded-full bg-[#1C1915]", corner)}
          key={corner}
        />
      ))}
    </div>
  );
}

/**
 * The app's theme, turned to night, for shared controls that read theme tokens
 * rather than the page's own colors, such as the sign-in form.
 */
const LINK_PAGE_NIGHT_TOKENS = {
  "--background": "#1C1915",
  "--border": "rgba(255, 252, 246, 0.14)",
  "--card": "#2A2622",
  "--card-foreground": "#FFFCF6",
  "--destructive": "#E27B6E",
  "--foreground": "#FFFCF6",
  "--input": "rgba(255, 252, 246, 0.14)",
  "--muted": "#2A2622",
  "--muted-foreground": "rgba(255, 252, 246, 0.6)",
  "--popover": "#2A2622",
  "--popover-foreground": "#FFFCF6",
  "--primary": "#FFFCF6",
  "--primary-foreground": "#2D3436",
  "--ring": "rgba(255, 252, 246, 0.7)",
  "--secondary": "#2A2622",
  "--secondary-foreground": "#FFFCF6",
  "--secondary-hover": "#34302B",
} as CSSProperties;

function LinkPageError({ children }: { children: ReactNode }) {
  return (
    <p className="pb-2 text-center text-[15px] leading-5 text-[#E27B6E]" role="alert">
      {children}
    </p>
  );
}

export {
  LINK_PAGE_GOLD,
  LINK_PAGE_LINK_CLASS,
  LINK_PAGE_NIGHT_TOKENS,
  LINK_PAGE_PILL_CLASS,
  LinkPageError,
  LinkPageFrame,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
  LinkPageSurface,
  LinkPageTicket,
  linkPageHeadline,
};

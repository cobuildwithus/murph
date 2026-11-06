import Image from "next/image";
import type { ComponentProps, CSSProperties, ReactNode, Ref } from "react";

import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

// A page Murph links to sits on the app's night ground, like a challenge invite.
const LINK_PAGE_PILL_CLASS =
  "flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#FFFCF6] text-[17px] font-semibold text-[#2D3436] transition-[opacity,scale] duration-150 hover:opacity-90 active:scale-[0.98] motion-reduce:transition-none";

const LINK_PAGE_LINK_CLASS =
  "h-11 rounded-lg px-3 text-[15px] font-semibold text-[#FFFCF6] underline-offset-4 hover:underline";

function LinkPageSurface({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-1 flex-col bg-[#1C1915] text-[#FFFCF6]"
      data-slot="link-page-surface"
    >
      <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3 sm:my-auto sm:flex-none sm:py-12">
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

function LinkPageFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-[#1C1915]">
      {/* The night ground reaches past the page: overscroll and Safari's bars. */}
      <style>{"html,body{background:#1C1915}"}</style>
      <LinkPageSurface>{children}</LinkPageSurface>
    </main>
  );
}

/**
 * A link page on a dashboard route that renders on the server, so there is no
 * flash of the dashboard. It covers the frame, and hides that frame from the tab
 * order and screen readers too.
 */
function LinkPageCover({ children }: { children: ReactNode }) {
  return (
    <div className="visible fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#1C1915]">
      <style>{"html,body{background:#1C1915}[data-slot=sidebar-wrapper]{visibility:hidden}"}</style>
      <LinkPageSurface>{children}</LinkPageSurface>
    </div>
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
  headingRef?: Ref<HTMLHeadingElement>;
  title: string;
}) {
  return (
    <section className="flex flex-1 flex-col" data-slot="link-page-screen">
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
      <div className="flex flex-1 flex-col justify-center py-6">{children}</div>
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
  kicker,
  title,
}: {
  kicker: string;
  title: string;
}) {
  return (
    <div
      className="relative mt-[26px] flex flex-col gap-1 overflow-hidden px-5 py-[18px]"
      style={{
        background:
          "linear-gradient(135deg, #EBD18B 0%, #D9B969 55%, #C59D4E 100%)",
      }}
    >
      <span className="break-words font-mono text-[10px] uppercase leading-[14px] tracking-[0.2em] text-[#3B2A12]/80">
        {kicker}
      </span>
      <span className="font-serif text-[26px] font-semibold leading-8 text-[#3B2A12]">
        {title}
      </span>
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

/** Shared forms keep some light-theme styling of their own. This turns that night too. */
const LINK_PAGE_FORM_CLASS =
  "[&_button[data-slot=button]]:rounded-full [&_input]:border-[#FFFCF6]/15 [&_input]:bg-[#2A2622] [&_input]:text-[#FFFCF6]";

function LinkPageError({ children }: { children: ReactNode }) {
  return (
    <p className="pb-2 text-center text-[15px] leading-5 text-[#E27B6E]" role="alert">
      {children}
    </p>
  );
}

export {
  LinkPageCover,
  LINK_PAGE_FORM_CLASS,
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
};

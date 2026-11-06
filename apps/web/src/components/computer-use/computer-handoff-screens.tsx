import type { ReactNode } from "react";

import { ComputerHandoffReplyAction } from "@/src/components/computer-use/computer-handoff-reply-action";
import { LinkPageContactPill } from "@/src/components/link-page/link-page-contact";
import { LinkPageDots } from "@/src/components/link-page/link-page-dots";
import {
  LINK_PAGE_PILL_CLASS,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

const HANDOFF_DONE_REPLY_BODY = "Done";
const SECURE_SIGN_IN_FAILED_TITLE = "Secure sign-in could not start.";

export function ComputerHandoffManagedWaitingScreen({ href }: { href: string }) {
  return (
    <LinkPageScreen
      actions={<a className={LINK_PAGE_PILL_CLASS} href={href}>Check again</a>}
      detail="Check again in a moment."
      title="Finishing secure sign-in."
    >
      <LinkPageDots />
    </LinkPageScreen>
  );
}

export function ComputerHandoffManagedRetryScreen({ href }: { href: string }) {
  return (
    <LinkPageScreen
      actions={<a className={LINK_PAGE_PILL_CLASS} href={href}>Try again</a>}
      detail="Try again. If the site still cannot connect, return to Murph and ask for a live browser link."
      title={SECURE_SIGN_IN_FAILED_TITLE}
    />
  );
}

export function ComputerHandoffManagedFailedScreen() {
  return (
    <LinkPageScreen
      actions={<a className={LINK_PAGE_PILL_CLASS} href="/home">Return to Murph</a>}
      detail="The secure sign-in provider could not connect. Return to Murph and ask for a live browser link."
      title={SECURE_SIGN_IN_FAILED_TITLE}
    />
  );
}

export function ComputerHandoffSavingScreen({
  announceDetail = true,
}: {
  announceDetail?: boolean;
}) {
  return (
    <LinkPageScreen
      announceDetail={announceDetail}
      detail="Keep this tab open for a moment."
      title="Saving your progress."
    >
      <LinkPageDots />
    </LinkPageScreen>
  );
}

export function ComputerHandoffCompletedScreen({
  contactOptions,
  emailReturn,
}: {
  contactOptions: MurphContactOption[];
  emailReturn: boolean;
}) {
  return (
    <LinkPageScreen
      actions={contactOptions.length > 0
        ? <ComputerHandoffReplyAction options={contactOptions} />
        : undefined}
      detail={emailReturn
        ? "Reply with Done in your existing Murph email thread to continue."
        : "Reply to Murph to continue."}
      title="All set."
    >
      {emailReturn ? (
        <HandoffReplyBody>Reply in the existing email thread with:</HandoffReplyBody>
      ) : contactOptions.length === 0 ? (
        <HandoffReplyBody>Reply with:</HandoffReplyBody>
      ) : null}
    </LinkPageScreen>
  );
}

export function ComputerHandoffExpiredScreen({
  contactOption,
}: {
  contactOption: MurphContactOption | null;
}) {
  return (
    <LinkPageScreen
      actions={contactOption ? <LinkPageContactPill option={contactOption} /> : undefined}
      detail="Return to Murph and ask for a new link."
      title="This link expired."
    />
  );
}

function HandoffReplyBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-medium leading-[22px] text-[#FFFCF6]/60">
        {children}
      </p>
      <p className="break-words rounded-[18px] bg-[#2A2622] px-4 py-3 text-base font-semibold leading-[22px]">
        {HANDOFF_DONE_REPLY_BODY}
      </p>
    </div>
  );
}

/** A browser window, drawn plainly: the step may be a sign-in, a card, or a check. */
export function ComputerHandoffBrowserObject() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto flex w-full max-w-[318px] shrink-0 flex-col overflow-hidden rounded-[18px] bg-[#2A2622]"
    >
      <div className="flex h-10 items-center gap-1.5 px-3.5">
        {[0, 1, 2].map((dot) => (
          <span className="size-[9px] rounded-full bg-[#FFFCF6]/20" key={dot} />
        ))}
        <span className="min-w-0 flex-1 pr-[39px] text-center text-[13px] font-medium leading-[18px] text-[#FFFCF6]/60">
          Private browser
        </span>
      </div>
      <div className="relative flex h-44 flex-col gap-2.5 bg-[#FFFCF6] px-[22px] py-5">
        <span className="h-3.5 w-2/5 rounded-full bg-[#2D3436]/15" />
        <span className="mt-1 h-[34px] rounded-[9px] border-[1.5px] border-[#2D3436]/15" />
        <span className="h-[34px] rounded-[9px] border-[1.5px] border-[#2D3436]/15" />
        <svg
          className="absolute bottom-3 right-[30px]"
          height="34"
          viewBox="0 0 30 34"
          width="30"
        >
          <path
            d="M4 2l22 15-10 2 6 12-5 2-6-12-7 7z"
            fill="#D9B969"
            stroke="#3B2A12"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </div>
    </div>
  );
}

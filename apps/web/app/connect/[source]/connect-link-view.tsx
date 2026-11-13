import Image from "next/image";

import { LinkPageScanCode } from "@/src/components/link-page/scan-code";
import { MURPH_IOS_APP_STORE_URL } from "@/src/lib/site-metadata";

export type ConnectLinkSource = { logoPath: string; name: string };

/**
 * What `withmurph.ai/connect/<source>` shows when the Murph app did not take
 * the link: the invite page's layout on its night ground. On an iPhone or iPad
 * it offers the app and a way into it. On a computer it shows a code for the
 * same link, since Apple Health only lives on the phone. The device decides
 * which, never the width; width only moves the code beside the card.
 */
export function ConnectLinkView(props: { appUrl: string; linkUrl: string; onComputer: boolean; source: ConnectLinkSource }) {
  const { source } = props;
  return (
    <div className="@container flex flex-1 flex-col bg-[#1C1915] text-[#FFFCF6]">
      <div className="flex flex-1 flex-col @5xl:flex-row @5xl:items-center @5xl:justify-center @5xl:gap-20">
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col px-6 pb-6 pt-3 sm:my-auto sm:flex-none sm:py-16 @5xl:mx-0">
          <div className="flex h-11 shrink-0 items-center">
            <Image alt="Murph" className="h-[25px] w-auto" height={25} priority src="/logo-dark.svg" width={112} />
          </div>
          <section className="pt-5">
            <ConnectLinkCard source={source} />
            <h1 className="mt-7 text-balance font-serif text-[40px] font-semibold leading-[44px] tracking-[-0.02em] sm:text-5xl sm:leading-[52px]">
              {`Connect ${source.name} in Murph.`}
            </h1>
            {props.onComputer ? null : (
              <p className="mt-2.5 text-pretty text-base font-medium leading-[22px] text-[#FFFCF6]/60">
                It&apos;s an iPhone app. Get it, then tap the link in your text again.
              </p>
            )}
          </section>
          {props.onComputer ? null : (
            <div className="mt-auto flex flex-col items-center gap-4 pt-10 sm:mt-0 sm:pt-12">
              <a
                className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#FFFCF6] text-[17px] font-semibold text-[#2D3436] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#FFFCF6]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1C1915]"
                href={MURPH_IOS_APP_STORE_URL}
              >
                <AppleLogo />
                Get the app
              </a>
              <p className="text-center text-[15px] font-medium leading-5 text-[#FFFCF6]/60">
                Already have Murph?{" "}
                <a className="rounded-sm font-semibold text-[#FFFCF6] underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#FFFCF6]/70" href={props.appUrl}>
                  Open it
                </a>
              </p>
            </div>
          )}
        </div>
        {props.onComputer ? (
          <div className="flex flex-col items-center gap-5">
            <LinkPageScanCode
              detail={`Your phone opens Murph on the ${source.name} step.`}
              label={`A code that opens Murph on the ${source.name} step.`}
              title="Scan to connect."
              url={props.linkUrl}
            />
            <p className="pb-10 text-center text-[15px] font-medium leading-5 text-[#FFFCF6]/60 @5xl:pb-0">
              No Murph yet?{" "}
              <a className="rounded-sm font-semibold text-[#FFFCF6] underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#FFFCF6]/70" href={MURPH_IOS_APP_STORE_URL}>
                Get it on the App Store
              </a>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The link's card: Murph and the source, joined by dots, on the app's cream. */
function ConnectLinkCard({ source }: { source: ConnectLinkSource }) {
  return (
    <div aria-hidden className="flex h-[174px] items-center justify-center gap-3.5 rounded-[20px] bg-[#F5F0E8]">
      <Image alt="" className="size-[82px] rounded-[19px] border border-[#E6DED0]" height={82} src="/brand-logos/murph-logo-avatar-light.png" width={82} />
      <svg height="7" viewBox="0 0 40 6" width="48">
        {[3, 11.5, 20, 28.5, 37].map((cx) => <circle cx={cx} cy="3" fill="#C59D4E" key={cx} r="2.6" />)}
      </svg>
      <span className="flex size-[82px] items-center justify-center overflow-hidden rounded-[19px] border border-[#E6DED0] bg-white">
        <Image alt="" className="size-full object-contain" height={82} src={source.logoPath} width={82} />
      </span>
    </div>
  );
}

function AppleLogo() {
  return (
    <svg aria-hidden fill="currentColor" height="20" viewBox="0 0 17 20" width="17">
      <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4zM11.6 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.5z" />
    </svg>
  );
}

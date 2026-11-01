import Image from "next/image";

import { buttonVariants } from "@/src/components/ui/button";
import { MURPH_IOS_APP_STORE_URL } from "@/src/lib/site-metadata";

export function GameRecapView(props: { appUrl: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col">
      <Image alt="Murph" className="h-6 w-auto self-start" height={24} priority src="/logo.svg" width={107} />
      <section className="py-12 sm:py-16">
        <h1 className="text-balance font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
          Your recap is in Murph.
        </h1>
        <div className="mt-8 flex flex-col gap-4">
          <a className={buttonVariants({ className: "w-full", size: "xl" })} href={props.appUrl}>
            Open in Murph
          </a>
          <p className="text-center text-sm leading-6 text-muted-foreground">
            No Murph yet?{" "}
            <a className={buttonVariants({ className: "h-auto px-0", size: "unstyled", variant: "link" })} href={MURPH_IOS_APP_STORE_URL}>
              Get it on the App Store
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}

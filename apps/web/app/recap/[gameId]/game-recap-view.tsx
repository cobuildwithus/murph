import Image from "next/image";
import qrcode from "qrcode-generator";

import { buttonVariants } from "@/src/components/ui/button";
import { MURPH_IOS_APP_STORE_URL } from "@/src/lib/site-metadata";

export function GameRecapView(props: { appUrl: string } | { recapUrl: string }) {
  let qrSvg: string | undefined;
  if ("recapUrl" in props) {
    const qr = qrcode(0, "M");
    qr.addData(props.recapUrl);
    qr.make();
    qrSvg = qr.createSvgTag({ cellSize: 1, margin: 4, scalable: true });
  }
  return (
    <div className="mx-auto flex max-w-md flex-col">
      <Image alt="Murph" className="h-6 w-auto self-start" height={24} priority src="/logo.svg" width={107} />
      <section className="py-12 sm:py-16">
        <h1 className="text-balance font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
          Your recap is in Murph.
        </h1>
        <div className="mt-8 flex flex-col gap-4">
          {"appUrl" in props ? (
            <a className={buttonVariants({ className: "w-full", size: "xl" })} href={props.appUrl}>
              Open in Murph
            </a>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <p className="text-center text-sm leading-6">Scan with your iPhone camera to watch it.</p>
              <div
                aria-label="Scan with your iPhone camera to watch it."
                className="size-44 overflow-hidden rounded-xl bg-white [&>svg]:size-full"
                role="img"
                dangerouslySetInnerHTML={{ __html: qrSvg ?? "" }}
              />
            </div>
          )}
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

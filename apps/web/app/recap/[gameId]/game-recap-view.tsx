import Image from "next/image";
import qrcode from "qrcode-generator";

import { buttonVariants } from "@/src/components/ui/button";
import { MURPH_IOS_APP_STORE_URL } from "@/src/lib/site-metadata";

import styles from "./game-recap-view.module.css";

export function GameRecapView(props: { appUrl: string } | { recapUrl: string }) {
  if ("recapUrl" in props) {
    const qr = qrcode(0, "M");
    qr.addData(props.recapUrl);
    qr.make();
    return (
      <div className={styles.desktop}>
        <Image alt="Murph" className={styles.logo} height={24} priority src="/logo.svg" width={107} />
        <div className={styles.composition}>
          <section className={styles.card}>
            <div aria-hidden="true" className={styles.bars}>
              {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
            </div>
            <div className={styles.copy}>
              <p className={`${styles.eyebrow} font-mono`}>MURPH · THE RECAP</p>
              <h1 className={`${styles.heading} font-serif`}>
                Your week,{" "}<span>in pictures.</span>
              </h1>
              <p className={styles.instruction}>
                Scan the ticket with your iPhone camera{" "}<span>to watch it in Murph.</span>
              </p>
            </div>
            <div className={styles.ticket}>
              <div className={styles.ticketBody}>
                <p className={`${styles.admission} font-mono`}>✦ ADMIT TWO ✦</p>
                <div className={styles.qrCard}>
                  <div
                    aria-label="Scan the ticket with your iPhone camera to watch it in Murph."
                    className={styles.qr}
                    role="img"
                    dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 1, margin: 4, scalable: true }) }}
                  />
                </div>
                <p className={`${styles.ticketTitle} font-serif`}>The Recap</p>
              </div>
            </div>
          </section>
          <p className={styles.store}>
            No Murph yet?{" "}
            <a href={MURPH_IOS_APP_STORE_URL}>Get it on the App Store</a>
          </p>
        </div>
      </div>
    );
  }
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

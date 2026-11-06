import Image from "next/image";
import qrcode from "qrcode-generator";

import {
  LINK_PAGE_LINK_CLASS,
  LINK_PAGE_PILL_CLASS,
  LinkPageScreen,
  LinkPageTicket,
} from "@/src/components/link-page/link-page-shell";
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
    <LinkPageScreen
      actions={
        <>
          <a className={LINK_PAGE_PILL_CLASS} href={props.appUrl}>
            Open in Murph
          </a>
          <a className={LINK_PAGE_LINK_CLASS} href={MURPH_IOS_APP_STORE_URL}>
            No Murph yet? Get it on the App Store
          </a>
        </>
      }
      announceDetail={false}
      detail="Your recap is in Murph."
      title="Your week, in pictures."
    >
      <LinkPageTicket
        className="mt-0"
        kicker="Admit two"
        size="display"
        title="The Recap"
      />
    </LinkPageScreen>
  );
}

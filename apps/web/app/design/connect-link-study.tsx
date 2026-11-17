import { ConnectLinkShareCard } from "@/app/connect/[source]/connect-link-share-card";
import { ConnectLinkView } from "@/app/connect/[source]/connect-link-view";

import { ScaledSharePreview } from "./scaled-share-preview";

const APPLE_HEALTH = { logoPath: "/brand-logos/connect/apple-health.png", name: "Apple Health" };
const COROS = { logoPath: "/brand-logos/connect/coros.png", name: "COROS" };
const APP_URL = "ai.withmurph.app://connect/apple-health";
const LINK_URL = "https://www.withmurph.ai/connect/apple-health";

/**
 * The production `/connect/[source]` page a browser shows when the Murph app
 * did not take the link, and its link preview. Preview only; the buttons are
 * inert here.
 */
export function ConnectLinkStudy() {
  return (
    <div className="flex flex-col gap-8" data-design-study="connect-link" id="connect-link">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        The link opens the Murph app on a source&rsquo;s connect step. Without the app, an iPhone or iPad gets Get
        the app and a way in; a computer gets a code for the same link. The device decides which, never the width.
        Sources that sign in on their own website never render this page: they go to the website&rsquo;s connect page.
      </p>
      <figure className="flex flex-col gap-3">
        <figcaption className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Apple Health, on a computer
        </figcaption>
        <div className="flex min-h-[640px] flex-col overflow-hidden rounded-3xl" data-design-state="computer" id="connect-link-computer" inert>
          <ConnectLinkView appUrl={APP_URL} linkUrl={LINK_URL} onComputer source={APPLE_HEALTH} />
        </div>
      </figure>
      <div className="grid items-start gap-6 md:grid-cols-2">
        {[{ id: "phone", label: "Apple Health, on an iPhone", source: APPLE_HEALTH }, { id: "phone-relay", label: "A wearable that comes in through Apple Health", source: COROS }].map((state) => (
          <figure className="flex flex-col gap-3" key={state.id}>
            <figcaption className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {state.label}
            </figcaption>
            <div className="flex min-h-[760px] flex-col overflow-hidden rounded-3xl" data-design-state={state.id} id={`connect-link-${state.id}`} inert>
              <ConnectLinkView appUrl={APP_URL} linkUrl={LINK_URL} onComputer={false} source={state.source} />
            </div>
          </figure>
        ))}
      </div>
      <figure className="flex max-w-xl flex-col gap-3" data-design-state="preview" id="connect-link-preview">
        <figcaption className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          The 1200x630 link preview
        </figcaption>
        <div inert>
          <ScaledSharePreview frameId="connect-link-preview">
            <ConnectLinkShareCard murphIcon="/brand-logos/murph-logo-avatar-light.png" sourceIcon={APPLE_HEALTH.logoPath} />
          </ScaledSharePreview>
        </div>
      </figure>
    </div>
  );
}

import Link from "next/link";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export default async function NotFound() {
  const { authenticated } = await getHostedPageAuthSnapshot();
  const backHref = authenticated ? "/home" : "/";
  const backLabel = authenticated ? "Back to Murph home" : "Back to Murph";

  return (
    <>
      <main className="flex min-h-[80vh] flex-col items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h1 className="font-serif text-7xl font-semibold tracking-tight text-foreground">
            404
          </h1>

          <h2 className="mt-8 font-serif text-3xl font-semibold tracking-tight text-foreground">
            Page not found
          </h2>
          <p className="mx-auto mt-4 max-w-[54ch] text-sm leading-7 text-muted-foreground">
            {authenticated
              ? "That address could not be found. Return to your Murph home to continue, review your settings, or contact support if you need help."
              : "That address does not match a public Murph page. Return to Murph, learn what the product does, contact support, or use the machine-readable guides below to find another public route."}
          </p>

          <Link
            href={backHref}
            prefetch={false}
            className="mt-10 inline-block rounded-2xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {backLabel}
          </Link>

          <nav
            aria-label="Page recovery links"
            className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-3 text-sm"
          >
            {authenticated ? (
              <>
                <Link className="underline underline-offset-4" href="/settings">
                  Settings
                </Link>
                <Link className="underline underline-offset-4" href="/contact">
                  Contact support
                </Link>
              </>
            ) : (
              <>
                <Link className="underline underline-offset-4" href="/about">
                  About
                </Link>
                <Link className="underline underline-offset-4" href="/contact">
                  Contact
                </Link>
                <a className="underline underline-offset-4" href="/llms.txt">
                  Agent guide
                </a>
                <a className="underline underline-offset-4" href="/sitemap.xml">
                  Sitemap
                </a>
              </>
            )}
          </nav>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

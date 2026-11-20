import { SiteFooter } from "@/src/components/homepage/site-footer";
import { NotFoundContent } from "@/src/components/public/not-found-content";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export default async function NotFound() {
  const { authenticated } = await getHostedPageAuthSnapshot();

  return (
    <>
      <main className="flex min-h-[80vh] flex-col items-center justify-center px-6">
        <NotFoundContent authenticated={authenticated} />
      </main>
      <SiteFooter />
    </>
  );
}

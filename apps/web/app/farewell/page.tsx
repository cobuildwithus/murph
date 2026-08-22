import type { Metadata } from "next";

import { AccountDeletionFarewell } from "@/src/components/settings/account-deletion-farewell";

export const metadata: Metadata = {
  description: "A quiet farewell after closing a Murph account.",
  robots: { follow: false, index: false },
  title: "Farewell for now | Murph",
};

export default async function FarewellPage({
  searchParams,
}: {
  searchParams: Promise<{ cleanup?: string | string[] }>;
}) {
  const { cleanup } = await searchParams;

  return (
    <main>
      <AccountDeletionFarewell
        cleanupPending={cleanup === "pending"}
      />
    </main>
  );
}

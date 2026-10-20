import type { ReactNode } from "react";
import { SettingsStatusLine } from "@/src/components/settings/connected-account-card";
import { HostedAuthLegalNotice } from "./hosted-auth-shared";

// The auth owner supplies live controls; presentation studies supply inert ones.
export function HostedAuthEntryLayout({ children, alternatives, alternativeError = null, showPassiveLegalNotice = false }: {
  children: ReactNode;
  alternatives?: ReactNode;
  alternativeError?: string | null;
  showPassiveLegalNotice?: boolean;
}) {
  return <>
    {children}
    {alternatives ? <>
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>
      <SettingsStatusLine message={alternativeError} tone="destructive" className="empty:hidden" />
      <div className="grid grid-cols-2 gap-3 [&>*]:!order-none">{alternatives}</div>
    </> : null}
    {showPassiveLegalNotice ? <HostedAuthLegalNotice /> : null}
  </>;
}

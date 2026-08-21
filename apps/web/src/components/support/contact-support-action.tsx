import { MailIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { MURPH_SUPPORT_EMAIL } from "@/src/lib/public-contact";
import { cn } from "@/src/lib/utils";

export { MURPH_SUPPORT_EMAIL };

export function buildContactSupportMailto({
  body,
  subject,
}: {
  body?: string;
  subject?: string;
} = {}) {
  const query = new URLSearchParams();

  if (subject) {
    query.set("subject", subject);
  }

  if (body) {
    query.set("body", body);
  }

  const suffix = query.toString();

  return `mailto:${MURPH_SUPPORT_EMAIL}${suffix ? `?${suffix}` : ""}`;
}

export function shouldShowContactSupportAction(message: string | null | undefined) {
  return /\bcontact support\b/i.test(message ?? "");
}

export function ContactSupportAction({
  body,
  children = "Email support",
  className,
  subject,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  body?: string;
  children?: ReactNode;
  subject?: string;
}) {
  return (
    <a
      {...props}
      className={cn(
        "inline-flex w-fit items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/20 focus-visible:ring-offset-2",
        className,
      )}
      href={buildContactSupportMailto({ body, subject })}
    >
      <MailIcon className="size-4" aria-hidden="true" />
      {children}
    </a>
  );
}

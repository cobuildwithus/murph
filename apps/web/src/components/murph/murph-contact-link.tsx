import type { ReactNode } from "react";

import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export function MurphContactLink({
  actionLabel,
  children,
  className,
  option,
}: {
  actionLabel: string;
  children: ReactNode;
  className?: string;
  option: MurphContactOption;
}) {
  const opensInNewTab = option.target === "_blank";

  return (
    <a
      className={className}
      href={option.href}
      target={option.target}
      rel={option.rel}
      aria-label={`${actionLabel} in ${option.label}${
        opensInNewTab ? " (opens in a new tab)" : ""
      }`}
    >
      {children}
      {opensInNewTab ? <span className="sr-only"> Opens in a new tab.</span> : null}
    </a>
  );
}

"use client";

import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

interface MurphContactLinkProps
  extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "aria-label" | "href" | "rel" | "target"
  > {
  actionLabel: string;
  children?: ReactNode;
  option: MurphContactOption;
}

export const MurphContactLink = forwardRef<HTMLAnchorElement, MurphContactLinkProps>(
  function MurphContactLink({
    actionLabel,
    children,
    className,
    option,
    ...props
  }, ref) {
    const opensInNewTab = option.target === "_blank";

    return (
      <a
        {...props}
        ref={ref}
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
  },
);

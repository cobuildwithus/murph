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
    const link = resolveMurphContactLink(option);
    const opensInNewTab = link.target === "_blank";

    return (
      <a
        {...props}
        ref={ref}
        className={className}
        href={link.href}
        target={link.target}
        rel={link.rel}
        aria-label={`${actionLabel} in ${link.label}${
          opensInNewTab ? " (opens in a new tab)" : ""
        }`}
      >
        {children}
        {opensInNewTab ? <span className="sr-only"> Opens in a new tab.</span> : null}
      </a>
    );
  },
);

function resolveMurphContactLink(option: MurphContactOption): {
  href: string;
  label: string;
  rel?: string;
  target?: string;
} {
  if (option.kind === "email" && option.webmail) {
    return {
      href: option.webmail.href,
      label: option.webmail.label,
      rel: "noopener noreferrer",
      target: "_blank",
    };
  }

  return {
    href: option.href,
    label: option.label,
    rel: option.rel,
    target: option.target,
  };
}

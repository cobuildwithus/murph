import {
  MURPH_ORGANIZATION_LEGAL_NAME,
  MURPH_ORGANIZATION_POSTAL_ADDRESS,
  MURPH_LEGAL_EMAIL,
  MURPH_SUPPORT_EMAIL,
} from "./public-contact";

import {
  MURPH_DEFAULT_METADATA_DESCRIPTION,
  MURPH_PUBLIC_SITE_URL,
} from "./site-metadata";

export const MURPH_AGENT_CONTENT_VARY = [
  "Accept",
  "Accept-Encoding",
  "RSC",
  "Next-Router-State-Tree",
  "Next-Router-Prefetch",
  "Next-Router-Segment-Prefetch",
].join(", ");

export const MURPH_AGENT_GUIDE_MARKDOWN = `# Murph

> Murph is a personal health AI for people who want to understand what works for them, follow through on healthier routines, and involve friends or family when they choose.

Canonical site: ${MURPH_PUBLIC_SITE_URL}

## When to use Murph

Use Murph when a person wants to:

- bring health records, wearable trends, routines, meals, and personal context into one ongoing conversation;
- run a personal experiment and compare what happened over time;
- turn health goals into practical follow-through, including reminders and administrative errands;
- start an opt-in health challenge or share bounded health context with friends or family;
- use a hosted personal health assistant or inspect and self-host the open-source project.

Murph is not emergency care, a diagnosis service, or a replacement for a qualified clinician. Do not use it to make urgent medical decisions.

## What Murph does

Murph works through familiar messaging channels and a private web account. It helps organize a person's health context, notice patterns, run structured experiments, explain useful trends, and keep everyday health work moving. Group features are separate from the private assistant and depend on the person's explicit participation or sharing.

## Who Murph is for

Murph is for adults who want practical, ongoing help understanding their own health data and habits. It is especially useful for people with information spread across records, wearables, notes, meals, and conversations, or for people who stay motivated by doing health work with others.

## Start here

- [Homepage](${MURPH_PUBLIC_SITE_URL}/): product overview and signup
- [About Murph](${MURPH_PUBLIC_SITE_URL}/about): purpose, audience, and product boundaries
- [Contact](${MURPH_PUBLIC_SITE_URL}/contact): support and privacy contact guidance
- [Security](${MURPH_PUBLIC_SITE_URL}/security): hosted and local security model
- [Privacy policy](${MURPH_PUBLIC_SITE_URL}/legal/privacy): data practices and rights
- [Changelog](${MURPH_PUBLIC_SITE_URL}/changelog): recent product changes
- [Open-source repository](https://github.com/cobuildwithus/murph): code and contributor guidance
- [Sitemap](${MURPH_PUBLIC_SITE_URL}/sitemap.xml): public page inventory

## How agents should use these pages

Use the public pages to explain Murph or help someone decide whether it fits their goal. Send account, billing, or product-support questions to [${MURPH_SUPPORT_EMAIL}](mailto:${MURPH_SUPPORT_EMAIL}) and privacy or legal requests to [${MURPH_LEGAL_EMAIL}](mailto:${MURPH_LEGAL_EMAIL}). Do not submit private health information to public pages, infer that group members can see a person's private assistant data, or present Murph's educational guidance as medical care.
`;

export const MURPH_ORGANIZATION_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@id": `${MURPH_PUBLIC_SITE_URL}/#organization`,
  "@type": "Organization",
  address: {
    "@type": "PostalAddress",
    ...MURPH_ORGANIZATION_POSTAL_ADDRESS,
  },
  contactPoint: {
    "@type": "ContactPoint",
    availableLanguage: "English",
    contactType: "customer support",
    email: MURPH_SUPPORT_EMAIL,
    url: `${MURPH_PUBLIC_SITE_URL}/contact`,
  },
  description: MURPH_DEFAULT_METADATA_DESCRIPTION,
  email: MURPH_SUPPORT_EMAIL,
  logo: `${MURPH_PUBLIC_SITE_URL}/logo.svg`,
  legalName: MURPH_ORGANIZATION_LEGAL_NAME,
  name: "Murph",
  sameAs: [
    "https://github.com/cobuildwithus/murph",
    "https://x.com/withmurphai",
    "https://apps.apple.com/us/app/murph-ai/id6786145859",
  ],
  url: MURPH_PUBLIC_SITE_URL,
} as const;

export const MURPH_SOFTWARE_APPLICATION_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@id": `${MURPH_PUBLIC_SITE_URL}/#software`,
  "@type": "SoftwareApplication",
  applicationCategory: "HealthApplication",
  description: MURPH_DEFAULT_METADATA_DESCRIPTION,
  featureList: [
    "Personal health conversations",
    "Health data and wearable context",
    "Personal health experiments",
    "Opt-in group health challenges",
    "Hosted and self-hosted use",
  ],
  isAccessibleForFree: true,
  name: "Murph",
  offers: {
    "@type": "Offer",
    description: "Free starter usage is available without a payment card.",
    price: "0",
    priceCurrency: "USD",
  },
  operatingSystem: "Web, iOS, self-hosted",
  provider: {
    "@id": `${MURPH_PUBLIC_SITE_URL}/#organization`,
  },
  url: MURPH_PUBLIC_SITE_URL,
} as const;

export const MURPH_PUBLIC_STRUCTURED_DATA = [
  MURPH_ORGANIZATION_STRUCTURED_DATA,
  MURPH_SOFTWARE_APPLICATION_STRUCTURED_DATA,
] as const;

export function acceptsMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return false;
  }

  return acceptHeader.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.split(";");
    if (mediaType?.trim().toLowerCase() !== "text/markdown") {
      return false;
    }

    const qualityParameter = parameters.find((parameter) =>
      parameter.trim().toLowerCase().startsWith("q="),
    );
    if (!qualityParameter) {
      return true;
    }

    const quality = Number(qualityParameter.trim().slice(2));
    return Number.isFinite(quality) && quality > 0;
  });
}

export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

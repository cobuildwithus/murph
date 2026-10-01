import {
  MURPH_LEGAL_EMAIL,
  MURPH_ORGANIZATION_LEGAL_NAME,
  MURPH_ORGANIZATION_POSTAL_ADDRESS,
  MURPH_SECURITY_MAILTO_HREF,
  MURPH_SUPPORT_EMAIL,
} from "./public-contact";

export interface PublicTrustPageAction {
  detail: string;
  href: string;
  label: string;
}

export interface PublicTrustPageContent {
  action?: PublicTrustPageAction;
  eyebrow: string;
  introduction: string;
  layout?: "editorial" | "compact";
  sections: readonly {
    action?: PublicTrustPageAction;
    paragraphs: readonly string[];
    title: string;
  }[];
  title: string;
}

export const ABOUT_MURPH_CONTENT: PublicTrustPageContent = {
  eyebrow: "About Murph",
  introduction:
    "Murph is a personal health AI that helps people understand what works for them and keep the practical work of health moving. It brings scattered context into one ongoing relationship, then helps turn that context into useful questions, personal experiments, and everyday follow-through.",
  sections: [
    {
      title: "What Murph does",
      paragraphs: [
        "Health information rarely lives in one place. Records, wearable data, meals, routines, goals, and the details someone remembers from a conversation all tell part of the story. Murph helps organize that context, explain relevant patterns, and make it easier to decide what to try next.",
        "People can use Murph to run structured personal experiments, keep up with routines, understand changes over time, and handle practical health errands. Murph is designed to remain useful between appointments while making it easier to have a better-informed conversation with a clinician.",
      ],
    },
    {
      title: "Who it is for",
      paragraphs: [
        "Murph is for adults who want ongoing, practical help with their health instead of another dashboard they have to interpret alone. It can be useful for someone investigating a stubborn pattern, building a habit, reviewing longitudinal data, or simply trying to stay on top of the work their health requires.",
        "Some people work best with others. Murph also supports opt-in challenges and group experiences for friends and families. A group does not automatically gain access to anyone's private assistant or private health context; participation and sharing remain bounded choices.",
      ],
    },
    {
      title: "How it is built",
      paragraphs: [
        "Murph is available as a hosted product and as an open-source project that can be inspected and run locally. The hosted product is designed around a private personal conversation, explicit permissions, encrypted storage, and short-lived processing for work that needs readable data.",
        "The code is published under the Apache 2.0 license. The public security page explains the hosted and local models, while the privacy policy describes data practices, retention, and user rights in detail.",
      ],
    },
    {
      title: "What Murph is not",
      paragraphs: [
        "Murph provides educational health information and organizational tools. It is not emergency care, does not diagnose or treat disease, and is not a substitute for professional medical advice. People should use a qualified clinician for medical decisions and local emergency services for urgent help.",
      ],
    },
  ],
  title: "Health is personal. The help should be, too.",
};

export const CONTACT_MURPH_CONTENT: PublicTrustPageContent = {
  action: {
    detail: "Account, billing, connected services, and product help",
    href: `mailto:${MURPH_SUPPORT_EMAIL}`,
    label: MURPH_SUPPORT_EMAIL,
  },
  eyebrow: "Contact",
  introduction:
    "Email support for help with your account, billing, connected services, or the product. For privacy or legal requests, use the contact below.",
  layout: "compact",
  sections: [
    {
      title: "Product support",
      paragraphs: [
        "Tell us what happened, what you expected, and which page or feature you were using. Screenshots are welcome, but remove health details and other private information first.",
        "Never email passwords, sign-in codes, private keys, or full card numbers. Murph support will not ask for them.",
      ],
    },
    {
      title: "Privacy and legal",
      action: {
        detail: "Privacy and formal legal requests",
        href: `mailto:${MURPH_LEGAL_EMAIL}`,
        label: MURPH_LEGAL_EMAIL,
      },
      paragraphs: [
        "For privacy questions or requests to access, correct, export, or delete your data, use the legal contact below.",
        `Formal correspondence can also be mailed to ${MURPH_ORGANIZATION_LEGAL_NAME}, ${MURPH_ORGANIZATION_POSTAL_ADDRESS.streetAddress}, ${MURPH_ORGANIZATION_POSTAL_ADDRESS.addressLocality}, ${MURPH_ORGANIZATION_POSTAL_ADDRESS.addressRegion} ${MURPH_ORGANIZATION_POSTAL_ADDRESS.postalCode}, ${MURPH_ORGANIZATION_POSTAL_ADDRESS.addressCountry}.`,
      ],
    },
    {
      title: "Security concerns",
      action: {
        detail: "Security reports · subject: Security",
        href: MURPH_SECURITY_MAILTO_HREF,
        label: MURPH_SUPPORT_EMAIL,
      },
      paragraphs: [
        "Found a security issue? Put “Security” in the subject and include the affected Murph surface and the minimum steps needed to reproduce it. Do not include another person's data or any secrets.",
      ],
    },
    {
      title: "Urgent help",
      paragraphs: [
        "Murph support is not an emergency or clinical service. For urgent symptoms, contact local emergency services. For diagnosis or treatment, contact a qualified clinician.",
      ],
    },
  ],
  title: "Contact Murph.",
};

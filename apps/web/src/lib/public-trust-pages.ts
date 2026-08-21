import {
  MURPH_LEGAL_EMAIL,
  MURPH_ORGANIZATION_LEGAL_NAME,
  MURPH_ORGANIZATION_POSTAL_ADDRESS,
  MURPH_SUPPORT_EMAIL,
} from "./public-contact";

export interface PublicTrustPageContent {
  action?: {
    detail: string;
    href: string;
    label: string;
  };
  eyebrow: string;
  introduction: string;
  sections: readonly {
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
    detail: "Account, billing, connected-service, and product support",
    href: `mailto:${MURPH_SUPPORT_EMAIL}`,
    label: MURPH_SUPPORT_EMAIL,
  },
  eyebrow: "Contact",
  introduction:
    "The support inbox is the main public contact for Murph product help. Use it for account access, billing, connected services, product questions, or unexpected behavior. A clear subject and a short description of the problem help the team understand where to start. Privacy and formal legal requests use the legal contact listed below.",
  sections: [
    {
      title: "Product and account help",
      paragraphs: [
        "Email support when sign-in, billing, a connected service, an export, or another product flow is not working as expected. Include the page or feature involved, what you expected, and what happened instead. Screenshots can help, but remove unrelated health details, access codes, payment information, and other private material first.",
        "Murph will never need a password, one-time sign-in code, private key, or full payment-card number in a support email. Do not send those credentials. If identity or account ownership must be verified, support will use an appropriate verification path rather than asking for a secret by email.",
      ],
    },
    {
      title: "Privacy and data requests",
      paragraphs: [
        `Privacy questions, access requests, correction requests, export questions, and deletion requests can begin at ${MURPH_LEGAL_EMAIL}. Say that the message concerns privacy and identify the request you want to make. The privacy policy and consumer health data notice explain available rights, verification, retention, and appeal paths.`,
      ],
    },
    {
      title: "Security concerns",
      paragraphs: [
        "If you believe you found a security problem, put “Security” in the subject and describe the affected public surface and the minimum steps needed to reproduce it. Do not include another person's data, exploit a live account, or send secrets. The public security page explains Murph's hosted and local security model.",
      ],
    },
    {
      title: "Medical and urgent help",
      paragraphs: [
        "The support inbox is not monitored as an emergency or clinical service. Do not use it for urgent symptoms or time-sensitive medical decisions. Contact local emergency services for an emergency and a qualified clinician for diagnosis, treatment, medication, or other medical advice.",
      ],
    },
    {
      title: "Formal and legal contact",
      paragraphs: [
        `Murph is offered by ${MURPH_ORGANIZATION_LEGAL_NAME} Formal legal and privacy correspondence can be sent to ${MURPH_LEGAL_EMAIL} or mailed to ${MURPH_ORGANIZATION_POSTAL_ADDRESS.streetAddress}, ${MURPH_ORGANIZATION_POSTAL_ADDRESS.addressLocality}, ${MURPH_ORGANIZATION_POSTAL_ADDRESS.addressRegion} ${MURPH_ORGANIZATION_POSTAL_ADDRESS.postalCode}, ${MURPH_ORGANIZATION_POSTAL_ADDRESS.addressCountry}.`,
      ],
    },
  ],
  title: "Start with the right inbox.",
};

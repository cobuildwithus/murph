import {
  ActivityIcon,
  FlaskConicalIcon,
  MessageCircleIcon,
  TrendingUpIcon,
} from "lucide-react";

export const JOIN_INVITE_ACTIVE_FEATURE_CARDS = [
  {
    body: "When you need evidence instead of another guess, test a clear protocol and review what changed.",
    icon: FlaskConicalIcon,
    title: "Run an experiment when useful",
  },
  {
    body: "Murph remembers relevant history, preferences, constraints, actions, and outcomes for later help.",
    icon: TrendingUpIcon,
    title: "Build useful context",
  },
  {
    body: "Text Murph via iMessage, Telegram, or email.",
    icon: MessageCircleIcon,
    title: "Chat wherever you live",
  },
  {
    body: "Fitbit, other supported wearables, and lab results can inform answers, plans, and experiments.",
    icon: ActivityIcon,
    title: "Health connected",
  },
] as const;

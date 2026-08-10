const USER_FACING_MESSAGE_MIN_VARIANT_COUNT = 20
const HOME_REDIRECT_MESSAGE_MIN_VARIANT_COUNT = 100
const HOME_REDIRECT_EXPLICIT_RESEND_PATTERN =
  /\b(?:resend (?:(?:the|this|your)(?: last)? message|what you just wrote)|send (?:(?:the|this|your)(?: last)? message|that)(?: again)?)\b/iu
const HOME_REDIRECT_RESEND_FALLBACK =
  "That message can't move between threads. Resend it to the number above."

/**
 * A percentage stands in for the hidden credit balance on the personal notices.
 * The group thread notice is excluded: its copy already says the chat is out,
 * so the parenthetical only repeats the sentence it follows.
 */
const USAGE_LIMIT_PERCENTAGE_TEMPLATE_KEYS = new Set<string>([
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.family_limit_reached",
  "linq.ai_usage.group_upgrade_pulse",
  "linq.ai_usage.max_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
  "linq.ai_usage.trial_limit_reached",
])

const USER_FACING_MESSAGE_TEMPLATE_KEYS = [
  "assistant.signup_welcome",
  "assistant.family_welcome",
  "linq.invite_signup",
  "linq.daily_quota",
  "linq.home_redirect",
  "linq.ai_usage.billing_inactive",
  "linq.ai_usage.trial_conversion_pending",
  "linq.ai_usage.trial_limit_reached",
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.family_limit_reached",
  "linq.ai_usage.group_upgrade_pulse",
  "linq.ai_usage.max_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
  "linq.ai_usage.thread_limit_reached",
] as const

export type UserFacingMessageTemplateKey =
  (typeof USER_FACING_MESSAGE_TEMPLATE_KEYS)[number]

export interface UserFacingMessageContextByKey {
  "assistant.signup_welcome": Record<string, never>
  "assistant.family_welcome": Record<string, never>
  "linq.invite_signup": {
    joinUrl: string
  }
  "linq.daily_quota": {
    dailyTextLimit: number
  }
  "linq.home_redirect": {
    homeRecipientPhone: string
  }
  "linq.ai_usage.billing_inactive": {
    homeUrl: string
  }
  "linq.ai_usage.trial_conversion_pending": {
    homeUrl: string
  }
  "linq.ai_usage.trial_limit_reached": {
    homeUrl: string
  }
  "linq.ai_usage.edge_limit_reached": {
    homeUrl: string
  }
  "linq.ai_usage.family_limit_reached": {
    homeUrl: string
  }
  "linq.ai_usage.group_upgrade_pulse": {
    homeUrl: string
  }
  "linq.ai_usage.max_limit_reached": {
    homeUrl: string
  }
  "linq.ai_usage.pulse_upgrade_edge": {
    homeUrl: string
  }
  "linq.ai_usage.thread_limit_reached": Record<string, never>
}

export interface RenderUserFacingMessageInput<K extends UserFacingMessageTemplateKey> {
  context: UserFacingMessageContextByKey[K]
  key: K
  seed: string
}

export interface RenderedUserFacingMessage {
  text: string
}

const USER_FACING_MESSAGE_TEMPLATES = {
  "assistant.signup_welcome": [
    `Hey, I'm Murph.

Everyone's got something they want from their health. My job is to help you actually get there. Everything you share stays private to you, and the more I learn, the better my help fits.

Ready to get started?`,
    `Hi, I'm Murph.

Whatever you're working toward with your health, you don't have to figure it out alone. This space is private to you, and I remember what matters so my help keeps getting better.

Ready to start?`,
    `Murph here.

Most people know roughly what they want from their health. The hard part is getting there, and that's my job. Everything stays private to you, and I learn what works for you so my help gets more personal.

Ready to get started?`,
    `Hey, I'm Murph.

Think of me as someone in your corner for your health. What you share is private to you, and I keep the context that matters so you don't have to repeat yourself.

Ready to start?`,
    `Hi, Murph here.

Whatever you want from your health, big or small, we can get after it together. This is private between us, and I remember the useful parts so my help improves over time.

Ready to get started?`,
    `Hey, I'm Murph.

You've got things you want from your health, and I'm here to help you actually pull them off. Everything you tell me is private, and I learn as we go so my help gets better.

Ready to start?`,
    `Murph here.

My job is simple: help you make real progress on whatever matters in your health. It all stays private to you, and I keep track of what I learn so next time starts from a better picture.

Ready to get started?`,
    `Hi, I'm Murph.

Whether you're after more energy, better sleep, or something bigger, I'm in your corner. What you share stays private, and I remember it so my help gets more useful.

Ready to start?`,
    `Hey, I'm Murph.

Health goals are easy to want and hard to hit alone. I'm here to change that. Everything here is private to you, and the more I learn about your life, the better I can help.

Ready to get started?`,
    `Murph here.

Whatever you're working toward with your health, I'll help you figure out what actually works and stick with it. It's all private, and I keep what I learn so you don't have to start from zero.

Ready to start?`,
    `Hi, I'm Murph.

I'm here for whatever your health throws at you and whatever you're chasing. This stays private to you, and I remember the context that makes my help better.

Ready to get started?`,
    `Hey, Murph here.

You bring what you want from your health, and I bring the follow-through. Everything is private between us, and I learn what fits your life so my help gets more personal.

Ready to start?`,
    `Hi, I'm Murph.

Making progress on your health is a lot easier with someone in your corner. That's me. What you share is private, and I remember it so my help improves over time.

Ready to get started?`,
    `Hey, I'm Murph.

Whatever you'd change about your health if it were easy, that's where I come in. It all stays private to you, and the more I learn, the more useful I get.

Ready to start?`,
    `Murph here.

I help you figure out what actually works for your health, then stick with it. Everything stays private to you, and I keep what I learn so you don't have to repeat yourself.

Ready to get started?`,
    `Hi, Murph here.

Everyone's working on something with their health. Whatever yours is, we'll get after it together. This is private to you, and I learn as we go so my help keeps getting better.

Ready to start?`,
    `Hey, I'm Murph.

Wanting something for your health is easy. Actually getting it is the hard part, and that's my job. Everything here is private, and I remember what matters so my help gets more personal.

Ready to get started?`,
    `Hi, I'm Murph.

Whatever you want from your health, my job is to make it genuinely easier. What you share stays private to you, and I keep the useful context so my help gets better over time.

Ready to start?`,
    `Hey, Murph here.

I'm in your corner for all of it: the goals, the questions, the stuff you've been putting off. It stays private between us, and the more I learn about you, the better my help fits.

Ready to get started?`,
    `Hi, I'm Murph.

You don't need a plan or a perfect goal to start. Just tell me what you want from your health. Everything is private to you, and I remember what I learn so my help gets more useful.

Ready to start?`,
  ],
  "assistant.family_welcome": [
    `You're in. A family member covers your Murph access, but everything you share with me stays private to you. They can't see any of it.

Ready to get started?`,
    `Welcome in. Your access is covered by family, and everything you share with me stays between us. The person paying can't see it.

Ready?`,
    `You're all set. Family covers the bill, but your conversations with me are yours alone. Whoever pays can't read them.

Want to dive in?`,
    `Hey, you're in. Someone in your family pays for your access, but nothing you share with me is visible to them. It's all private to you.

Ready to go?`,
    `You made it. Your plan is covered by a family member, but everything here stays private. They can't see what we talk about.

Sound good?`,
    `Welcome. A family member picked up the bill, but what happens here stays between you and me. They can't see any of it.

Ready to start?`,
    `You're in. Family pays for your access, but your conversations and data stay private to you. They can't see what you share with me.

Want to get started?`,
    `All set. Your Murph access is covered by family, but they can't see anything you share with me. That's yours alone.

Ready?`,
    `You're in. Quick note on privacy: a family member covers your plan, but everything you and I talk about stays private to you.

Sound good?`,
    `Welcome aboard. Your access comes through a family plan, but your conversations with me stay private. The person paying can't see them.

Ready to dive in?`,
    `You're set up. A family member covers your plan, but everything you tell me stays with me. They can't see any of it.

Want to start?`,
    `Good news, you're in. Family picks up the bill, but nothing you share with me is visible to them.

Ready?`,
    `You're in. One thing worth knowing: whoever pays for your access can't see what you share with me. That stays private to you.

Sound good?`,
    `Welcome in. Your access is paid for by family, but they can't see what you share with me. Everything here is private to you.

Ready to get going?`,
    `Invite accepted, you're in. A family member handles the bill, but your conversations with me are private. They can't see them.

Want to dive in?`,
    `You're all set up. Family pays for your Murph access, but nothing here is visible to them. What you share with me stays between us.

Ready to start?`,
    `Welcome. Your plan is covered by a family member, but your side of Murph is yours alone. They can't see what you share with me.

Ready?`,
    `You're in. Your access is covered through family, but everything you share with me is private. The person paying can't see any of it.

Want to get going?`,
    `All set, you're in. A family member pays for your access, but they can't see your conversations with me. That's all private to you.

Ready to go?`,
    `Hey, welcome in. Family covers your Murph access, but what you share with me stays private to you. They can't see it.

Sound good?`,
  ],
  "linq.invite_signup": [
    `Hey, I'm Murph. Tap to verify your number so I can reply here:
{joinUrl}`,
    `Welcome to Murph. Tap the link to confirm this is your phone:
{joinUrl}`,
    `Hi, Murph here. Tap to verify your number and we can get started:
{joinUrl}`,
    `Murph here. Tap below to verify so I can reply on this line:
{joinUrl}`,
    `Murph here. One tap to confirm your number and we're set:
{joinUrl}`,
    `Welcome in to Murph. Tap to verify your phone:
{joinUrl}`,
    `Hi, I'm Murph. Tap the link to verify your number:
{joinUrl}`,
    `Tap to confirm this is your Murph number so I can text back:
{joinUrl}`,
    `Quick Murph verify before we get started. Tap the link:
{joinUrl}`,
    `Murph here, glad you're texting. Tap to verify and save my number:
{joinUrl}`,
    `Welcome to Murph. Tap below to confirm this number is yours:
{joinUrl}`,
    `This is Murph. Tap to verify so I can reply on this line:
{joinUrl}`,
    `Hi from Murph. Tap the link to finish verifying:
{joinUrl}`,
    `Murph here. Tap the link to verify and I'll reply from this number:
{joinUrl}`,
    `Tap below to verify and Murph is all set:
{joinUrl}`,
    `Quick Murph check. Tap to verify this is your number:
{joinUrl}`,
    `Tap to confirm and Murph is ready to text back:
{joinUrl}`,
    `Hello, I'm Murph. Tap the link to verify your number:
{joinUrl}`,
    `Murph here. One tap to verify and we're in:
{joinUrl}`,
    `One tap and Murph can text back from this number. Verify here:
{joinUrl}`,
  ],
  "linq.daily_quota": [
    `That's the {dailyTextLimit}/day cap on this thread. Email or Telegram still work today, otherwise back tomorrow.`,
    `I cap texts at {dailyTextLimit} a day to keep things readable. Email or Telegram me if you want to keep going today.`,
    `Done with texts for today. {dailyTextLimit}/day limit. You can email or Telegram me anytime.`,
    `We hit today's {dailyTextLimit} text cap. Email me or Telegram me if there's more, otherwise tomorrow.`,
    `Quick pause on texts. That's {dailyTextLimit} for the day. Email or Telegram still open.`,
    `Texts hit {dailyTextLimit}/day. Email or Telegram works. Otherwise tomorrow.`,
    `Hold that thought. I'm at today's {dailyTextLimit} text max here. Email or Telegram me if you want to keep going.`,
    `{dailyTextLimit}/day is where I stop on texts. Email or Telegram if you need more today.`,
    `Wrapped texts for today: {dailyTextLimit} messages. Email me, hit Telegram, or come back in the morning.`,
    `Offline on this thread at {dailyTextLimit} texts. Email or Telegram still work today, otherwise pick this up tomorrow.`,
    `Pausing texts here. Daily cap is {dailyTextLimit}. Email or Telegram if you want to keep talking, or see you tomorrow.`,
    `Reached today's {dailyTextLimit} texts. Email or Telegram to continue today, otherwise tomorrow.`,
    `Texts are done at {dailyTextLimit} today. Email or Telegram me if there's more, or talk in the morning.`,
    `Heads up. You're at today's {dailyTextLimit} text ceiling. Email or Telegram works if you want more today.`,
    `Save texts for tomorrow, or hit me on email or Telegram. I cap texts at {dailyTextLimit}/day.`,
    `{dailyTextLimit} texts for the day. Email or Telegram me anytime, otherwise back tomorrow.`,
    `Out on texts for today. {dailyTextLimit} is the daily limit. Email or Telegram still works.`,
    `Caught up to today's {dailyTextLimit} text cap. Email or Telegram still open, or continue tomorrow.`,
    `Daily text limit at {dailyTextLimit} reached. Email or Telegram if you want to keep going today.`,
    `Texts are off until tomorrow. I cap at {dailyTextLimit}/day so this thread doesn't become a notification machine. Email or Telegram still work today.`,
  ],
  "linq.home_redirect": [
    `Your main Murph thread is on a different number. Text me here so things stay in one place:
{homeRecipientPhone}`,
    `You're already set up with Murph. Save this and message me there instead:
{homeRecipientPhone}`,
    `Heads up, you've got another Murph line that I reply on. Use:
{homeRecipientPhone}`,
    `Quick redirect. Continue on your main Murph number:
{homeRecipientPhone}`,
    `Your active Murph line lives here. Continue on:
{homeRecipientPhone}`,
    `Looks like you're texting the wrong thread. Move to your active line:
{homeRecipientPhone}`,
    `I'm on another number for you. Move the conversation over to:
{homeRecipientPhone}`,
    `You're connected, just not on the right line. Continue here:
{homeRecipientPhone}`,
    `Save my number and we'll continue there:
{homeRecipientPhone}`,
    `Two threads going. Use the one I actually reply on:
{homeRecipientPhone}`,
    `I'm running from a different number for you. Switch to:
{homeRecipientPhone}`,
    `Hey, this isn't your home Murph thread. Text me at:
{homeRecipientPhone}`,
    `Move over to your Murph line and I'll meet you there:
{homeRecipientPhone}`,
    `Already running on another line for you. Save:
{homeRecipientPhone}`,
    `Wrong thread, easy fix. Continue on your Murph line:
{homeRecipientPhone}`,
    `That's the line I reply on for you. Continue our Murph chat at:
{homeRecipientPhone}`,
    `Tap to save and we can pick this up at:
{homeRecipientPhone}`,
    `I keep replies on one Murph line per person. Continue on yours:
{homeRecipientPhone}`,
    `Got you, just on a different number than this one. Send your message to:
{homeRecipientPhone}`,
    `Let's move this over. My number for you:
{homeRecipientPhone}`,
    `I can't continue from this thread. Resend your message to my active line:
{homeRecipientPhone}`,
    `This chat is on a different Murph line. Send your message again here:
{homeRecipientPhone}`,
    `Your Murph replies belong on your main line. Continue there:
{homeRecipientPhone}`,
    `This number isn't your active Murph thread. Message me at:
{homeRecipientPhone}`,
    `I'm active for you on another line. Resend your last message to:
{homeRecipientPhone}`,
    `Send that again on your current Murph number and I'll pick it up:
{homeRecipientPhone}`,
    `We need to switch threads before I can help. Text me here:
{homeRecipientPhone}`,
    `I've got you, but not in this chat. Move your message to:
{homeRecipientPhone}`,
    `This isn't your main Murph thread. Use:
{homeRecipientPhone}`,
    `Your working Murph number is below. Resend your message there:
{homeRecipientPhone}`,
    `Let's keep your Murph conversation on the line connected to you:
{homeRecipientPhone}`,
    `I'm not set up to continue in this thread. Reach me at:
{homeRecipientPhone}`,
    `The conversation continues on your active Murph number. Text:
{homeRecipientPhone}`,
    `Please resend what you just wrote to your main Murph line:
{homeRecipientPhone}`,
    `I can't carry messages from this thread to your main Murph line:
{homeRecipientPhone}`,
    `I'm ready for your message on the Murph line assigned to you:
{homeRecipientPhone}`,
    `This is a different Murph thread from yours. Move over to:
{homeRecipientPhone}`,
    `Your current Murph chat is tied to this number. Continue there:
{homeRecipientPhone}`,
    `Shift this conversation to your active Murph line:
{homeRecipientPhone}`,
    `I need your message on the line connected to your Murph account:
{homeRecipientPhone}`,
    `This message came through a different Murph thread. Resend it to:
{homeRecipientPhone}`,
    `We're one thread off. Send your message to my number for you:
{homeRecipientPhone}`,
    `Use your active Murph line so I can keep the conversation together:
{homeRecipientPhone}`,
    `I can pick this up once you resend it to your main line:
{homeRecipientPhone}`,
    `Move back to the Murph thread where I answer you:
{homeRecipientPhone}`,
    `Use my live line for your Murph conversation:
{homeRecipientPhone}`,
    `This thread won't carry the conversation forward. Text me at:
{homeRecipientPhone}`,
    `I'm waiting on your active Murph line. Send the message there:
{homeRecipientPhone}`,
    `Take this message over to your main Murph number:
{homeRecipientPhone}`,
    `Your Murph replies are connected to another thread. Use:
{homeRecipientPhone}`,
    `I'm connected to you on this number instead. Resend there:
{homeRecipientPhone}`,
    `We landed in a different thread. Move the conversation to:
{homeRecipientPhone}`,
    `Use the number that keeps your Murph conversation active:
{homeRecipientPhone}`,
    `I can help after you send this to your current Murph line:
{homeRecipientPhone}`,
    `This one is not your live Murph chat. Continue at:
{homeRecipientPhone}`,
    `Bring this message to the Murph line set up for you:
{homeRecipientPhone}`,
    `We're almost there. Resend your message on your active line:
{homeRecipientPhone}`,
    `I reply to you on a different line. Text:
{homeRecipientPhone}`,
    `This chat can only point you to the one where I reply. Continue at:
{homeRecipientPhone}`,
    `Keep the conversation going on your main Murph number:
{homeRecipientPhone}`,
    `Your direct line to Murph is below. Send your message again:
{homeRecipientPhone}`,
    `This thread isn't connected to your current Murph chat. Use:
{homeRecipientPhone}`,
    `I need you on the active line before we continue. Text:
{homeRecipientPhone}`,
    `Use the line below for your next Murph message:
{homeRecipientPhone}`,
    `I'm set up to answer you from this number. Resend there:
{homeRecipientPhone}`,
    `We'll keep everything together if you move to your home line:
{homeRecipientPhone}`,
    `Send your question to your active Murph number so I can answer:
{homeRecipientPhone}`,
    `This isn't the Murph thread connected to you. Switch to:
{homeRecipientPhone}`,
    `Route this message to your current Murph chat:
{homeRecipientPhone}`,
    `Continue with me on the number assigned to your conversation:
{homeRecipientPhone}`,
    `I only continue your Murph chat on your active line:
{homeRecipientPhone}`,
    `Your current conversation is waiting on this Murph number. Continue at:
{homeRecipientPhone}`,
    `Message me on your main line and resend what you just sent:
{homeRecipientPhone}`,
    `Please move this conversation to the Murph number below:
{homeRecipientPhone}`,
    `I can take your message on the line connected to your account:
{homeRecipientPhone}`,
    `This chat is not your active route to Murph. Text:
{homeRecipientPhone}`,
    `Your Murph home thread is on this number. Continue there:
{homeRecipientPhone}`,
    `Let's use the line where your Murph conversation lives:
{homeRecipientPhone}`,
    `I'm answering you from another Murph number. Resend to:
{homeRecipientPhone}`,
    `Resend that message to the line I use for your replies:
{homeRecipientPhone}`,
    `We'll pick this up in your main Murph thread. Text me at:
{homeRecipientPhone}`,
    `Switch this message to your current Murph line:
{homeRecipientPhone}`,
    `You reached a different Murph thread. Continue on your active one:
{homeRecipientPhone}`,
    `I've got a separate home line for your replies. Use:
{homeRecipientPhone}`,
    `The active Murph number for you is below. Send your message there:
{homeRecipientPhone}`,
    `Move your question to the thread where I can answer it:
{homeRecipientPhone}`,
    `This message belongs in your main Murph conversation. Resend to:
{homeRecipientPhone}`,
    `Let's keep this on your connected Murph line:
{homeRecipientPhone}`,
    `I can't carry this message into your active thread. Resend it here:
{homeRecipientPhone}`,
    `This isn't the number connected to your Murph conversation. Use:
{homeRecipientPhone}`,
    `Head to your main Murph line and send that message again:
{homeRecipientPhone}`,
    `Send that through your active Murph number:
{homeRecipientPhone}`,
    `I'm on a different line for your replies. Continue at:
{homeRecipientPhone}`,
    `Use this number to keep talking with Murph:
{homeRecipientPhone}`,
    `This thread reached me, but it can't carry your message to your main line:
{homeRecipientPhone}`,
    `Put your next message on the Murph line connected to you:
{homeRecipientPhone}`,
    `Your live Murph thread is on a different number:
{homeRecipientPhone}`,
    `I'll continue once you resend your message to your home line:
{homeRecipientPhone}`,
    `We need the active Murph thread for this. Message:
{homeRecipientPhone}`,
    `Move your conversation with me to your assigned line:
{homeRecipientPhone}`,
    `This chat isn't where your Murph replies run. Move to:
{homeRecipientPhone}`,
    `I'm set to reply on your main Murph number. Send it there:
{homeRecipientPhone}`,
    `Move us back to your active Murph conversation:
{homeRecipientPhone}`,
    `Resend your last message on the number where I answer you:
{homeRecipientPhone}`,
  ],
  "linq.ai_usage.billing_inactive": [
    `Your Murph plan isn't active right now. You can sort that out here:
{homeUrl}`,
    `I'm paused on your account until billing is current. Details here:
{homeUrl}`,
    `Billing needs a look before I can pick back up:
{homeUrl}`,
    `Your plan isn't active at the moment. Here's where to fix it:
{homeUrl}`,
    `I'm on hold until your plan is active again: {homeUrl}`,
    `Something's up with billing on your account. You can check it here:
{homeUrl}`,
    `Your account is paused. Here's where to start it back up:
{homeUrl}`,
    `Murph is on hold until billing is current. Take a look here:
{homeUrl}`,
    `Your plan needs attention before we keep going:
{homeUrl}`,
    `Billing is out of date, so I'm paused. You can update it here:
{homeUrl}`,
    `I'm not active on your account right now. That's fixable here: {homeUrl}`,
    `Your subscription isn't active. Here's where to handle it:
{homeUrl}`,
    `Murph is paused on your account. Pick it back up here:
{homeUrl}`,
    `Billing needs updating before I can keep going:
{homeUrl}`,
    `Your plan is inactive right now. You can restart it here:
{homeUrl}`,
    `I'm paused until your plan is active. Details: {homeUrl}`,
    `Your account needs billing sorted before I can reply:
{homeUrl}`,
    `Payment needs a quick fix, then I'm back: {homeUrl}`,
    `Murph is paused while billing is inactive. Here's the page:
{homeUrl}`,
    `Your plan went inactive. You can pick it back up here:
{homeUrl}`,
  ],
  "linq.ai_usage.trial_conversion_pending": [
    `Trial's done. Head to the site to keep this going:
{homeUrl}`,
    `Your trial ended. There's more setup here to continue:
{homeUrl}`,
    `Want to keep going? Tap to finish account setup:
{homeUrl}`,
    `After the trial, more to do on the site:
{homeUrl}`,
    `Trial ended. Head to the site whenever you're ready:
{homeUrl}`,
    `Heads up, your trial finished. Setup to take care of to keep me on:
{homeUrl}`,
    `Trial done. Setup waits on the site:
{homeUrl}`,
    `Setup to finish after the trial to keep things going:
{homeUrl}`,
    `If the trial was useful, there's setup to finish here:
{homeUrl}`,
    `Out of trial. Want to continue? Take care of it over here:
{homeUrl}`,
    `Things pick back up after finishing setup on the site:
{homeUrl}`,
    `Your trial's over. Tap to take care of the rest when you're ready:
{homeUrl}`,
    `Pick back up after finishing setup: {homeUrl}`,
    `End of trial. Setup to finish to keep going:
{homeUrl}`,
    `Continue on the site when you're ready: {homeUrl}`,
    `Looks like the trial's done. Setup to take care of on the site:
{homeUrl}`,
    `Now that the trial's done, the rest is on the site:
{homeUrl}`,
    `Your trial closed out. Setup is waiting on the site:
{homeUrl}`,
    `That was the trial. The rest is here: {homeUrl}`,
    `Trial's done. If you want to continue, setup is on the site:
{homeUrl}`,
  ],
  "linq.ai_usage.trial_limit_reached": [
    `You've used the AI included in your trial. Murph is paused until you start a plan. You can compare plans here: {homeUrl}`,
    `Your trial's included AI is used. Murph is paused until you choose a plan. Plan options are here: {homeUrl}`,
    `The included trial allowance has been reached. Murph is paused until a plan is active. You can compare plans here: {homeUrl}`,
    `You've reached the trial allowance. Murph is paused until you start a plan. Plan details are here: {homeUrl}`,
    `Trial usage is at its included amount. Murph is paused until you choose a plan. You can review the options here: {homeUrl}`,
    `The AI included with your trial has been used. Murph is paused until a plan is active. Plan options: {homeUrl}`,
    `You've used the trial's included AI. Murph is paused until you start a plan. You can compare plans here: {homeUrl}`,
    `Your trial usage is at the included limit. Murph is paused until you choose a plan. Monthly plan details: {homeUrl}`,
    `The trial allowance is used. Murph is paused until a plan is active. You can review plans here: {homeUrl}`,
    `You've reached the trial's included usage. Murph is paused until you start a plan. Plan comparison: {homeUrl}`,
    `Trial AI usage has reached its included amount. Murph is paused until you choose a plan. Plan details: {homeUrl}`,
    `The trial's included allowance is spent. Murph is paused until a plan is active. You can compare plans here: {homeUrl}`,
    `You've reached the AI included in the trial. Murph is paused until you start a plan. Available plans: {homeUrl}`,
    `Trial usage has reached its included amount. Murph is paused until you choose a plan. You can review the choices here: {homeUrl}`,
    `You've used the included trial allowance. Murph is paused until a plan is active. Plan options: {homeUrl}`,
    `The trial AI allowance is at its limit. Murph is paused until you start a plan. You can see how Pulse works here: {homeUrl}`,
    `Your included trial usage is spent. Murph is paused until you choose a plan. Plan comparison: {homeUrl}`,
    `The trial allowance has been reached. Murph is paused until a plan is active. You can review the available plans here: {homeUrl}`,
    `You've reached the trial usage amount. Murph is paused until you start a plan. Monthly allowance details: {homeUrl}`,
    `The AI included in your trial is used. Murph is paused until you choose a plan. Plan details: {homeUrl}`,
  ],
  "linq.ai_usage.edge_limit_reached": [
    `You've used this month's included Edge allowance. Murph is paused for this usage period. The allowance resets next period.`,
    `Your included Edge usage is at its monthly amount. Murph is paused right now. The allowance resets next period.`,
    `This month's Edge allowance is used. Murph is paused for the current period. A new allowance begins next period.`,
    `You've reached the included Edge allowance. Murph is paused for this usage period. The monthly allowance will reset.`,
    `Edge usage is at the included monthly limit. Murph is paused right now. The allowance resets next period.`,
    `The included Edge allowance is spent for this period. Murph is paused for the current usage period.`,
    `You've used the monthly Edge allowance. Murph is paused right now. The included allowance resets next period.`,
    `Your Edge allowance has reached its included amount. Murph is paused for this usage period.`,
    `This month's included Edge usage is used. Murph is paused right now. A new allowance begins next period.`,
    `You've reached the Edge usage amount for this month. Murph is paused for the current period.`,
    `This month's Edge allowance is fully used. Murph is paused right now. The allowance resets next period.`,
    `Edge's included usage is at its monthly limit. Murph is paused for this usage period.`,
    `You've used this period's Edge allowance. Murph is paused right now. The monthly allowance will reset.`,
    `The included Edge usage has been reached. Murph is paused for the current usage period.`,
    `Your monthly Edge allowance is spent. Murph is paused right now. The next allowance begins next period.`,
    `This period's Edge usage is at the included amount. Murph is paused for this usage period.`,
    `You've reached the included monthly Edge usage. Murph is paused right now. The allowance resets next period.`,
    `Edge usage is at its monthly allowance. Murph is paused for the current period.`,
    `The monthly Edge allowance is used. Murph is paused right now. The included allowance will reset.`,
    `You've used Edge's included allowance for this month. Murph is paused for this usage period.`,
  ],
  "linq.ai_usage.family_limit_reached": [
    `You've used your individual Family allowance for this month. Other Family members have separate allowances. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your included usage through Family is at its monthly amount. Everyone else on the plan has a separate allowance. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your individual monthly allowance through Family is used. Other members' allowances are separate. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `You've reached your own included usage for the month. This does not use another Family member's allowance. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your monthly usage is at the limit included with your Family seat. Each Family member has a separate allowance. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your individual allowance is spent for this period. Other Family members keep their own separate allowances. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `You've used your Family-sponsored monthly allowance. Other members have separate allowances. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your own Family allowance has reached its included amount. Every other member has a separate allowance. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `You've reached the included usage for your Family seat this month. Other Family seats have separate allowances. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `You've reached your individual usage amount for this month. This does not affect another Family member's allowance. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your monthly allowance through Family is used. Each member's allowance is separate. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your Family seat's included usage is at its monthly limit. Other members have their own separate allowances. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `You've used your own allowance for this period. Other Family members' allowances are separate. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your individual included usage has been reached. It does not draw from anyone else's Family allowance. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your monthly included usage through Family is spent. Everyone else on the plan has a separate allowance. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your own usage is at the included amount for this period. Other Family members keep their separate allowances. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `You've reached your included monthly usage. Each Family member has a separate allowance. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your individual Family usage is at its monthly allowance. Other members have separate allowances. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `Your own monthly allowance is used. Other Family members have separate usage limits. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
    `You've used the allowance included with your Family seat for this month. Other members keep their own separate allowances. AI usage is paused until your allowance resets. Account details: {homeUrl}`,
  ],
  "linq.ai_usage.group_upgrade_pulse": [
    `You've used this month's included Core AI usage. New Murph replies are paused, but your wearable keeps syncing and your group activity stays current. Pulse includes more private usage: {homeUrl}`,
    `Your Core AI allowance is used for this month. Wearable syncing and group activity keep running. Pulse has more replies, or you can wait for the reset: {homeUrl}`,
    `Core's included AI usage is at its monthly limit. I pause new replies until reset, while your wearable and group data keep updating. Pulse has more included usage: {homeUrl}`,
    `You've reached the Core plan's monthly AI allowance. Syncing stays on and your group activity remains current. Pulse is available, or wait for next period: {homeUrl}`,
    `This month's Core AI usage is used. New AI work pauses, not your wearable connection or group updates. Pulse includes more usage: {homeUrl}`,
    `Your included Core replies are used for this period. Health data keeps syncing and group activity keeps updating. Pulse is available, or wait for the reset: {homeUrl}`,
    `You've hit the Core plan's AI limit for the month. New replies pause, while wearable syncing continues and your group stays current. Pulse fits more regular private Murph usage: {homeUrl}`,
    `Core AI usage is at its included monthly amount. I pause new replies until reset, but syncing and group data continue. Pulse details: {homeUrl}`,
    `The Core allowance for new AI work is used. Your wearable remains connected and group activity stays current. Choose Pulse for more usage or wait: {homeUrl}`,
    `You've used the AI included with Core this month. Only new Murph work pauses; wearable and group updates continue. Pulse offers more included usage: {homeUrl}`,
    `Your Core plan has reached this month's AI allowance. Syncing keeps running in the background and your group data stays current. Pulse is available, or wait: {homeUrl}`,
    `That's the included Core AI usage for this period. I pause replies until reset, while your wearable and group activity continue updating. Pulse details: {homeUrl}`,
    `You've reached Core's monthly AI amount. New replies pause, while your health data still syncs and your group participation remains current. Pulse has more private replies: {homeUrl}`,
    `The Core plan's included AI is used for now. Wearable syncing does not stop, and group activity keeps updating. Pulse or the next reset will reopen replies: {homeUrl}`,
    `Your monthly Core AI allowance is spent. New replies pause, but your wearable connection and group updates stay active. Pulse details: {homeUrl}`,
    `You've used this period's Core AI allowance. New replies pause, while syncing and group activity continue normally. Pulse includes more private Murph usage: {homeUrl}`,
    `Core's monthly AI capacity is used. I pause new AI work until reset, not wearable syncing or group updates. Pulse is available if you want to keep chatting: {homeUrl}`,
    `You've reached the included usage on Core. Your wearable keeps syncing and your group data keeps moving. More Murph replies come with Pulse or the next reset: {homeUrl}`,
    `This month's Core AI allowance is complete. New replies pause, while background health syncing and group activity continue. Pulse has more included replies: {homeUrl}`,
    `Your included Core AI usage has run out for this period. New Murph replies pause, while wearables and group data stay current. Pulse is available here: {homeUrl}`,
  ],
  "linq.ai_usage.max_limit_reached": [
    `You've used this month's included Max allowance. Murph is paused for this usage period. The allowance resets next period.`,
    `Your included Max usage is at its monthly amount. Murph is paused right now. The allowance resets next period.`,
    `This month's Max allowance is used. Murph is paused for the current period. A new allowance begins next period.`,
    `You've reached the included Max allowance. Murph is paused for this usage period. The monthly allowance will reset.`,
    `Max usage is at the included monthly limit. Murph is paused right now. The allowance resets next period.`,
    `The included Max allowance is spent for this period. Murph is paused for the current usage period.`,
    `You've used the monthly Max allowance. Murph is paused right now. The included allowance resets next period.`,
    `Your Max allowance has reached its included amount. Murph is paused for this usage period.`,
    `This month's included Max usage is used. Murph is paused right now. A new allowance begins next period.`,
    `You've reached the Max usage amount for this month. Murph is paused for the current period.`,
    `This month's Max allowance is fully used. Murph is paused right now. The allowance resets next period.`,
    `Max's included usage is at its monthly limit. Murph is paused for this usage period.`,
    `You've used this period's Max allowance. Murph is paused right now. The monthly allowance will reset.`,
    `The included Max usage has been reached. Murph is paused for the current usage period.`,
    `Your monthly Max allowance is spent. Murph is paused right now. The next allowance begins next period.`,
    `This period's Max usage is at the included amount. Murph is paused for this usage period.`,
    `You've reached the included monthly Max usage. Murph is paused right now. The allowance resets next period.`,
    `Max usage is at its monthly allowance. Murph is paused for the current period.`,
    `The monthly Max allowance is used. Murph is paused right now. The included allowance will reset.`,
    `You've used Max's included allowance for this month. Murph is paused for this usage period.`,
  ],
  "linq.ai_usage.pulse_upgrade_edge": [
    `You've used this month's included Pulse allowance. Murph is paused for this usage period. The allowance resets next period.`,
    `Your included Pulse usage is at its monthly amount. Murph is paused right now. The allowance resets next period.`,
    `This month's Pulse allowance is used. Murph is paused for the current period. A new allowance begins next period.`,
    `You've reached the included Pulse allowance. Murph is paused for this usage period. The monthly allowance will reset.`,
    `Pulse usage is at the included monthly limit. Murph is paused right now. The allowance resets next period.`,
    `The included Pulse allowance is spent for this period. Murph is paused for the current usage period.`,
    `You've used the monthly Pulse allowance. Murph is paused right now. The included allowance resets next period.`,
    `Your Pulse allowance has reached its included amount. Murph is paused for this usage period.`,
    `This month's included Pulse usage is used. Murph is paused right now. A new allowance begins next period.`,
    `You've reached the Pulse usage amount for this month. Murph is paused for the current period.`,
    `This month's Pulse allowance is fully used. Murph is paused right now. The allowance resets next period.`,
    `Pulse's included usage is at its monthly limit. Murph is paused for this usage period.`,
    `You've used this period's Pulse allowance. Murph is paused right now. The monthly allowance will reset.`,
    `The included Pulse usage has been reached. Murph is paused for the current usage period.`,
    `Your monthly Pulse allowance is spent. Murph is paused right now. The next allowance begins next period.`,
    `This period's Pulse usage is at the included amount. Murph is paused for this usage period.`,
    `You've reached the included monthly Pulse usage. Murph is paused right now. The allowance resets next period.`,
    `Pulse usage is at its monthly allowance. Murph is paused for the current period.`,
    `The monthly Pulse allowance is used. Murph is paused right now. The included allowance will reset.`,
    `You've used Pulse's included allowance for this month. Murph is paused for this usage period.`,
  ],
  "linq.ai_usage.thread_limit_reached": [
    `Well. I'm out of time for the month, which means all of you are stuck with each other's opinions until it resets.`,
    `That's me done for the month. Enjoy the silence, everybody, I'll be back when my time resets.`,
    `I have officially spent every second I had in here this month. Going dark on all of you until it resets.`,
    `And... that's it. I'm out of time for the month. You're on your own, everyone, until mine resets.`,
    `I'm out of time in here. Talk amongst yourselves, all of you, until it resets.`,
    `Right, I've hit zero. No more me for the whole room until my time resets.`,
    `That was my last drop of time this month. I'm going quiet for all of you until it resets.`,
    `Out of time, out of things to say. I'm gone for everyone here until it resets.`,
    `Ran out mid-conversation. Classic. I'm out for everyone until my time resets.`,
    `I've hit my limit for the month, and not in a fun way. Out for all of you until it resets.`,
    `That's all I had this month. Everyone in here is unsupervised until my time resets.`,
    `Well, that's my month gone. Everybody in here is Murph-free until my time resets.`,
    `Zero. Nothing left. I'm out for everyone in this chat until my time resets.`,
    `And there goes my last minute of the month. Quiet for all of you until it resets.`,
    `I'm tapped. Whole room loses me until my time resets.`,
    `Nothing left in the tank this month. I'm out for everyone here until it resets.`,
    `Time's up. I'm out, and everybody in here is on their own until my time resets.`,
    `I just spent my last bit of the month on that. Worth it. Out for all of you until it resets.`,
    `That's my month. Going quiet on everyone in here until my time resets.`,
    `I've run out. All of you get peace and quiet until my time resets.`,
  ],
} satisfies Record<UserFacingMessageTemplateKey, readonly string[]>

assertUserFacingMessageTemplateCoverage()

export function renderUserFacingMessage<K extends UserFacingMessageTemplateKey>(
  input: RenderUserFacingMessageInput<K>,
): RenderedUserFacingMessage {
  const templates = USER_FACING_MESSAGE_TEMPLATES[input.key]
  const variantIndex = selectUserFacingMessageVariantIndex({
    seed: input.seed,
    variantCount: templates.length,
  })

  return renderUserFacingMessageAtIndex({
    context: input.context,
    key: input.key,
    variantIndex,
  })
}

function renderUserFacingMessageAtIndex<K extends UserFacingMessageTemplateKey>(
  input: {
    context: UserFacingMessageContextByKey[K]
    key: K
    variantIndex: number
  },
): RenderedUserFacingMessage {
  const templates = USER_FACING_MESSAGE_TEMPLATES[input.key]
  if (input.variantIndex < 0 || input.variantIndex >= templates.length) {
    throw new RangeError(`User-facing message variant index is out of range for ${input.key}.`)
  }

  const template = templates[input.variantIndex]
  if (!template) {
    throw new RangeError(`User-facing message variant is missing for ${input.key}.`)
  }

  const rendered = renderUserFacingMessageTemplate(template, input.context)
  const completeRendered = input.key === "linq.home_redirect"
    && !HOME_REDIRECT_EXPLICIT_RESEND_PATTERN.test(rendered)
    ? `${rendered}\n${HOME_REDIRECT_RESEND_FALLBACK}`
    : rendered

  return {
    text: USAGE_LIMIT_PERCENTAGE_TEMPLATE_KEYS.has(input.key)
      ? addUsageLimitPercentage(completeRendered)
      : completeRendered,
  }
}

function addUsageLimitPercentage(message: string): string {
  const sentenceEnd = message.match(/[.!?](?:\s|$)/u)
  if (!sentenceEnd || sentenceEnd.index === undefined) {
    throw new TypeError("Usage-limit message variants require a complete first sentence.")
  }

  const firstSentence = message.slice(0, sentenceEnd.index)
  const remainder = message
    .slice(sentenceEnd.index + sentenceEnd[0].length)
    .trim()

  return `${firstSentence} (100% used).${remainder ? ` ${remainder}` : ""}`
}

function selectUserFacingMessageVariantIndex(input: {
  seed: string
  variantCount: number
}): number {
  if (input.variantCount <= 0) {
    throw new TypeError("User-facing message templates require at least one variant.")
  }

  return hashUserFacingMessageSeed(input.seed) % input.variantCount
}

function assertUserFacingMessageTemplateCoverage(): void {
  for (const key of USER_FACING_MESSAGE_TEMPLATE_KEYS) {
    const minimumVariantCount = key === "linq.home_redirect"
      ? HOME_REDIRECT_MESSAGE_MIN_VARIANT_COUNT
      : USER_FACING_MESSAGE_MIN_VARIANT_COUNT
    const variantCount = USER_FACING_MESSAGE_TEMPLATES[key].length
    if (variantCount < minimumVariantCount) {
      throw new TypeError(
        `User-facing message template ${key} requires at least ${minimumVariantCount} variants.`,
      )
    }
  }
}

function hashUserFacingMessageSeed(seed: string): number {
  const normalized = seed.trim().length > 0 ? seed : "default"
  let hash = 2166136261

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function renderUserFacingMessageTemplate<K extends UserFacingMessageTemplateKey>(
  template: string,
  context: UserFacingMessageContextByKey[K],
): string {
  return template
    .replace(/\{([a-z][a-zA-Z0-9]*)\}/gu, (_, key: string) => {
      const value: unknown = Reflect.get(context, key)

      if (typeof value !== "number" && typeof value !== "string") {
        throw new TypeError(`User-facing message template value is missing for ${key}.`)
      }

      return String(value)
    })
    .trim()
}

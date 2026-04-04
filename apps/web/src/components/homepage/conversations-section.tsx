const conversations = [
  {
    messages: [
      { from: "user", text: "I've been sleeping terribly this week. What's going on?" },
      { from: "bob", text: "Your Oura data shows your average deep sleep dropped from 1h 42m to 53m since Monday. You also started a new magnesium brand on Sunday — that timing lines up. Want to try switching back and I'll track the difference?" },
    ],
  },
  {
    messages: [
      { from: "user", text: "Log breakfast: two eggs, sourdough toast, black coffee" },
      { from: "bob", text: "Logged. That's about 380 cal, 24g protein. You've been consistent with high-protein mornings this week — your afternoon energy scores are up 15% vs. last month when you were skipping breakfast." },
    ],
  },
  {
    messages: [
      { from: "user", text: "What should I eat before my 6pm run?" },
      { from: "bob", text: "Based on your past runs, you perform best with a light carb snack 90 min before. A banana with a tablespoon of peanut butter has worked well for you — your last three runs after that combo averaged 8:12/mi vs. 8:45/mi fasted." },
    ],
  },
] as const;

export function ConversationsSection() {
  return (
    <section className="border-t border-stone-200 bg-olive">
      <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-white/40">
          See it in action
        </p>
        <h2 className="mb-12 max-w-md text-3xl font-bold tracking-tight text-white md:text-4xl">
          Real questions, real answers.
        </h2>
        <div className="grid gap-6 lg:grid-cols-3">
          {conversations.map((convo, index) => (
            <div
              key={index}
              className="space-y-3 rounded-lg bg-white/5 p-5 backdrop-blur-sm md:p-6"
            >
              {convo.messages.map((msg, msgIndex) => (
                <div
                  key={msgIndex}
                  className={
                    msg.from === "user"
                      ? "ml-8 rounded rounded-br-none bg-white/15 p-3 text-sm leading-relaxed text-white"
                      : "mr-8 rounded rounded-bl-none bg-white p-3 text-sm leading-relaxed text-stone-700"
                  }
                >
                  {msg.text}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

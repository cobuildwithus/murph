# Bounded observation runs

Use a bounded observation run when the user wants Murph to notice before changing behavior.

A valid run has one focus, a duration, a review point, and an off-ramp. Seven days is a sensible default when the user has not chosen another credible window.

Reuse existing meal, symptom, journal, wearable, memory, and automation surfaces. The observation run is a conversational plan, not a new persisted entity. If the plan must survive the current thread, store only its focus, window, and review preference in existing Context memory or confirmed automation instructions. Create a review automation only with the user's confirmation. Put the focus, window, relevant record types, and review rules directly in confirmed automation instructions.

At review:

- describe what showed up across the logged days, such as "on 4 of 5 logged days"
- describe observations and associations, not causal conclusions
- name a confounder only when it changes the next step
- offer at most one optional next step

An experiment is an option after review, not the required reward for logging. The user can extend, change focus, stop, or leave the observations alone.

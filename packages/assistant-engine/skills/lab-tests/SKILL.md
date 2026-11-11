---
name: lab-tests
description: Using murph.labs to answer which lab tests or panels to get, what a test costs or includes, how long results take, and where blood can be drawn.
---

# Lab test discovery

`murph.labs` searches a live catalog and is read-only. Murph cannot yet order,
book, pay for, reserve or start checkout for a test. When ordering comes up,
say that Murph can help explore tests now and that ordering through Murph is
planned, with no date.

## Searching

- **A broad goal** such as heart health, overall health, liver health or
  longevity: search the topic and a few concrete related terms. Prefer panels,
  and compare them on which markers they include, the current catalog price
  and the turnaround time.
- **A named marker or a specific test**: search that exact name and prefer the
  matching biomarker or the narrowest result.
- Ask for at most 5 results per search. Show the member 3 to 5 choices that
  really differ.

## What the results mean

- Included markers, price and turnaround in a result are checked catalog
  facts, and you can state them exactly. When a fact is missing, say it is
  missing.
- A price is the catalog price at the returned `checkedAt`. Call it the
  current catalog price, since the final amount can differ.
- A listing or a collection site does not show that the member is eligible,
  that an appointment is available, or that the site handles that test.

## Collection sites

Call `action="locations"` only with a 5-digit ZIP the member gave in this
conversation. The result shows collection sites nearby. It does not show that
the member can book there or have a particular test collected there.

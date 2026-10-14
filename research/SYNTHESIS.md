# Notice Decoder (SETU 2026, PS-02): what makes us different

Research date 2026-10-14. Built from: 3 Haiku research agents, 1 agy run, Claude's own GitHub scan and a chrono-node test.
opencode failed twice (free model endpoint down) and gave nothing. Every claim below is marked:
**[M]** measured by Claude, **[V]** source opened and checked by Claude, **[R]** reported by an agent with a source (not re-checked), **[A]** assumption / our idea.

---

## 1. The one-line answer

Most teams will build **paste -> ChatGPT/Gemini -> JSON -> table -> .ics**. That flow is already a commodity
(ScreenToCal, Doc2Calendar, text-2-ics.com are live sites [V]; a team at Bharat Builds hackathon, Sep 2026, built
"photo of college notice -> .ics" on AWS Bedrock and their frontend never went live [V]).

**Our difference: an explainable rules engine that shows WHY for every field, an Indian-aware clash engine, and
revision tracking. AI is only a labelled fallback, and everything runs in the browser, so the demo cannot die on Wi-Fi.**
This matches the judging text word for word: "smart use of rules or logic... clear explanations. AI is welcome
only where it adds value. Do not reward complexity for its own sake."

---

## 2. What is NOT unique (do not pitch these as new)

| Already exists | Who |
|---|---|
| Paste text / screenshot -> calendar event | ScreenToCal, Doc2Calendar, text-2-ics.com [V live], Gmail/Apple data detectors [R] |
| Photo of college notice -> .ics via LLM | harshwardhan-kp/notice-to-calendar, Bharat Builds hackathon, Sep 2026 [V] |
| Group-chat notices -> to-do list + subscribable `/calendar.ics`, confirm before adding, source traceable, data stays local | ExpertKT/notice-hub (China, QQ groups) [V]. Strongest prior art, but **no clash detection** |
| Paste text -> subscribable feed URL that updates | ccheever/ap-plaincal [V] |
| Syllabus PDF -> calendar | todue, Doc2Calendar, several student repos [V] |

## 3. Real gaps (with evidence)

1. **Deadline-inside-event clash with an explanation.** None of the repos I sampled has it [V, 6 searches only].
   agy says Google, Outlook, Fantastical and TimeTree treat a deadline as a reminder, not a clash [R, weak: agy's links were 3/9 dead].
2. **DD/MM trap.** chrono-node default reads `04/05/2026` as **5 April**; the en-GB parser reads it as **4 May** [M].
   An LLM has the same risk, and no benchmark exists for it [R]. Indian notices use DD/MM.
3. **Revisions are the normal case, not an edge case.** Real examples: Patna University moved a 12 noon-3 PM slot to 2-5 PM,
   Kashmir University moved 11 am to 12 noon except Fridays, postponements whose new dates live in a separate PDF [R, snippets].
   A revised notice must **update** the old event, not add a duplicate.
4. **Notices get lost in WhatsApp.** APSIT Mumbai stopped sharing notices in WhatsApp groups because "many students miss important
   notices" [V]. Jamia (Sep 2026) made official class groups run by the CR with a faculty monitor [V]. **The CR is the relay,
   and that makes the CR a natural buyer and distributor.**
5. **Clashes with holidays are news.** St Agnes College, Mangaluru: students protested exams scheduled in the Dasara holidays (PTI, 12 Oct 2026) [R, opened by agent].
6. **Hinglish / Indian shorthand.** chrono-node returns nothing for "kal 5 baje" [M]. FN/AN sessions, "12 noon", "pre-poned", "LT-3"
   are not handled by Western tools [R, untested].
7. **Field-level source highlight.** notice-hub links back to the whole message. Nobody found highlights the exact words that produced each field [V, sample].

## 4. Feature plan, ranked

**Core (Completeness = 35 marks, the biggest block). Must work perfectly on the PDF example first.**
Title / type / date / start-end / venue extraction, the "13 Nov", "13/11/2026", "2 PM", "14:00" formats, editing every field,
interval clash, deadline-as-point clash, valid .ics, a clear message for empty or garbage input, and a suggested action.
Test case is already in `examples/01-pdf-sample.*`.

| # | Differentiator | Judge hit | Demo moment | Effort |
|---|---|---|---|---|
| 1 | **"Why" per field + click to highlight source words** in the notice ("deadline because rule: `by` + time") | Innovation, UI/UX | Click "12:00 PM", "by 12:00 noon" lights up | S-M |
| 2 | **Clash timeline with plain-language result + action**: "30 min overlap 11:00-11:30; submit records before the test" (exactly like the PDF graphic) | Innovation, Completeness | Visual bar timeline + red diamond | M |
| 3 | **Ambiguity flags instead of silent guesses**: `04/05` -> "4 May or 5 Apr?"; missing year -> "assumed 2026, confirm"; missing end time -> default length, flagged | Completeness (wrong input) | Type 04/05 live, app asks | S |
| 4 | **Revised-notice diff**: paste the update -> "Internal Test 2: 13 Nov -> 15 Nov". Same `UID` + higher `SEQUENCE` in the .ics so calendars update instead of duplicating (RFC 5545 design [A]; **verify on Google Calendar import before claiming it**) | Innovation | Before/after card | M |
| 5 | **Indian-aware rules**: DD/MM default, "12 noon", FN/AN, "kal/parso/baje", gazetted holidays + "my exams" (JEE/CA etc.) in the clash check | Innovation | Hinglish line parses | S-M |
| 6 | **Runs fully in the browser, no upload, works offline (PWA)** | Completeness (reliable demo), Monetization (near-zero cost) | Turn Wi-Fi off mid-demo | S |
| 7 | **AI only as a labelled fallback** for lines the rules miss, shown in amber "AI guess, please check". Toggle off for the demo | Innovation ("AI only where it adds value") | Amber chip | M |
| 8 | Reminders by event type in the .ics (test: 1 day before, deadline: 3 h before) via `VALARM` | UI/UX | Phone pings | S |
| later | Photo/PDF OCR, WhatsApp bot, live subscribe feed | Risky in 24-48 h; Google's feed refresh delay is unpublished [R] | | L |

Recommended pitch order: 1 + 2 + 3 = the core story, 4 = the wow moment, 6 = the safety net. Skip OCR unless the core is done.

## 5. Monetization (30 marks)

- **User:** students (free, forever: paste, fix, clash, .ics). Notion Plus is free for students and TimeTree's core is free, so a free core is the norm [R].
- **Payer that scales: the department.** "CR/Faculty Publish" = faculty or the CR pastes a notice once, and the whole class gets a subscribe
  link. Today every notice is forwarded by hand (Jamia/APSIT evidence above). Sold as a yearly department licence.
  Anchor: a full college ERP like Fedena lists **$999 / $1,399 / $1,699 per year** [V on fedena.com/pricing-and-plans], so a
  single-purpose notice add-on must sit well below that. Our price is **[A]** and should be shown as a test, not a fact.
- **Paid student extras:** photo/PDF OCR, WhatsApp reminders (each message costs money, so it is paid; INR rate not confirmed [R]),
  auto-sync feed. Willingness-to-pay evidence is weak: a 2020 Gray Matters survey of *test-prep* app users (85% open to ₹100-250/month) [R]. Say so.
- **Cost:** rules run on the user's phone, so a notice costs us ~₹0. Hosting on the Cloudflare Pages/Workers free tier
  (Workers: 100,000 requests/day [R, Cloudflare docs]). The LLM fallback is the only per-use cost: a fraction of a rupee per notice [A, check the provider's price page].
- **Be honest in the pitch:** no college has paid yet. The plan is a 1-department pilot.

| Model | Who pays | Why they pay | Our cost |
|---|---|---|---|
| Free core | nobody | adoption | ~0 (runs in browser) |
| Department "Publish" licence | dept / college | one post reaches the whole class, fewer missed deadlines | ~0 |
| Student Pro extras | student / parent | OCR, WhatsApp reminders | per message + OCR compute |

## 6. Tech notes (measured / known)

- **chrono-node 2.10.3, `chrono.en.GB`** on the PDF notice [M]: "13 Nov 2026 from 10:00 AM to 11:30 AM" -> correct range; "13 Nov, 11:00 AM to 12:30 PM" -> correct range;
  **bug:** "by 12:00 noon on 13 Nov" also produces a stray `12:00` on today's date. Needs a pre-rule that merges "12:00 noon" -> "12:00 PM".
  So: library for ~90%, thin Indian rule layer on top. The test script is in `tmp/chrono-test/t.mjs`.
- **.ics musts (RFC 5545):** `VCALENDAR`/`VEVENT`, `UID`, `DTSTAMP`, CRLF line endings, lines folded at 75 octets, escape `, ; \`, and
  times either UTC (`Z`) or `TZID=Asia/Kolkata` with a `VTIMEZONE`. Test by importing into Google Calendar and Outlook before the demo.
- **Clash rule** (from the PS): A and B clash when `A.start < B.end && B.start < A.end`; a deadline is a point `t` and clashes when `start < t < end`.
  A college notice has under ~50 events, so a simple pairwise check is fine.

## 6b. Lessons from the owner's real notices (examples 02, 03) [M]

chrono-node read each date and time **on its own** and got the meaning wrong:
- Webinar: `Date: 15th October` + `Time: 6:30 PM` -> it put 6:30 PM on **today**, not 15 Oct.
- QSpiders: "today" -> the day it was pasted (14 Oct), not the notice date (05 Oct); "in 60min" -> a clock time; "this week" -> a past Sunday.

So the real engine is a **notice-context layer on top of the date library**, and this is our strongest "smart rules" story:
1. **Anchor date:** the date the notice states ("today's drive, Date: 05 Oct") sets "today", "tomorrow" and "next day".
2. **Pairing:** a time with no date attaches to the nearest labelled or preceding date (`Date:`/`Time:` lines, same sentence).
3. **Duration vs time:** "60 min", "40 questions in 60min" = how long, not when.
4. **Window vs event:** "available 1:30pm-5pm" = take the 60-min test inside this window.
5. **TBD items:** "this week or next week", "will be confirmed" -> a "waiting" list, never a fake date in the .ics.
6. **Contradiction check:** "results by today 9pm" vs "shared Next Day" in the same notice -> show both, flag.
7. **Stale notice:** every event before the paste date -> "this notice is 9 days old".
8. **Source trust:** an outside organiser asking you to join an unknown WhatsApp group, with no Zoom link -> "External / unverified". This is where it overlaps with PS-01 Scam Spotter.
9. **Event types beyond test/deadline/lecture:** webinar, session, results, GD, interview. Keep the PS's 3 types and add "Other" with a sub-label.
10. **Notes, not events:** instructions (no tab switching, no refresh) go to an "Important notes" list.

Points 1-7 are all deterministic rules, each with a visible "why". An LLM-only team gets some of them right some of the time, with no explanation.

## 7. Weak spots in this research

- No Reddit evidence (blocked). No data on how many Indian students actually use Google Calendar: **ask 5-10 classmates**.
- agy's competitor file says "verified" everywhere, but 3 of 9 links checked are 404. Use it only for leads.
- AISHE student numbers (4.33 crore, 2021-22) are not checked against the official PDF (403).
- DPDP Act dates conflict between sources. Do not claim "DPDP compliant". Say "no personal data leaves your phone".

## 8. Next inputs needed from the team

- Real messy notices (WhatsApp text, PDF, photos) -> put them in `examples/` as `NN-name.txt` + `NN-name.expected.md`.
- Hackathon length, team size, and stack preference; whether an AI API key is allowed or wanted.

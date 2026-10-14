# SETU 2026 Notice Decoder: beyond the AI wrapper

Research date: 2026-10-14. Tags: [verified: URL] = page opened this session; [search-snippet: URL] = seen only in search results, not opened; [unverified] = no usable source found.

## 1. LLM-only date/event extraction: known failure modes

- **Relative and vague dates degrade.** TRAVELER says performance "clearly deteriorates" as event sets grow and as references become less explicit; vague references scored lowest for all four models tested. [verified: https://arxiv.org/abs/2505.01325] The page gives no percentages and does not name the models.
- **Relative vs absolute drop.** Temporal Blind Spots reports drops of "23-30% and 24-35%" for alpaca-7B and text-davinci-003 when relative phrasing is used. [verified: https://ar5iv.labs.arxiv.org/html/2401.12078] These are 2024-era models, so the size is not a guide for current models.
- **Inconsistent per-primitive behaviour.** PRIMETIME's conclusion says models handle datetimes unevenly, "from near zero to perfect" depending on model and prompt, even on single primitives. [search-snippet: https://arxiv.org/pdf/2504.16155] I did not open the full paper, so I have no per-model numbers.
- **Silent wrong years and locale flips.** Parser bugs show the same patterns LLM output will have: a parser that falls back to the current year and rewrites unusual years silently; a locale mismatch where a bad month is silently bumped. [search-snippet: https://arxiv.org/pdf/2504.16155, https://www.ibm.com/support/pages/node/6459117] An SAP article describes an assistant reading a UK-format date as US. [search-snippet: https://userapps.support.sap.com/sap/support/knowledge/en/3781591]
- **No benchmark found for MM/DD vs DD/MM on LLMs.** [unverified: none found]
- **Cost, latency, rate limits, privacy:** not researched in depth. Treat as general knowledge: each run is a network call that can fail on stage. [unverified]

Takeaway for the hackathon: a deterministic date parser handles explicit dates and gives a reproducible, testable result. An LLM is useful only as a fallback for phrasing the rules miss, with its output marked as "needs check."

## 2. What judges say they are tired of

- A Devfolio write-up on its AI judge describes the agent flagging a project where "a team claimed a custom model and shipped a wrapper" and cutting Originality from 7 to 4. It also cut Technical Execution from 8 to 5 where a claimed "multi-tenant isolation" was not implemented. [verified: https://devfolio.co/blog/the-discerning-machine/] This is a vendor's own tool, so it shows what that vendor checks, not what all judges think.
- The same post rewards "implemented depth backed by citable code" and a "more specific workflow" over "generic summarization." [verified: https://devfolio.co/blog/the-discerning-machine/]
- One AI-hackathon guide: a rubric scores whether a project is a "novel use of AI or just a chatbot layered on top." [search-snippet: https://www.masaischool.com/blog/how-to-win-an-ai-hackathon-in-2026-full-guide/] I did not open it.
- A rubric describes innovation tiers from "replicates an existing demo" up to "groundbreaking." [search-snippet: https://abu-dhabi.aitinkerers.org/hackathons/h_1de1QREJyuU/entries] Not opened.
- A rubric from an OpenAI Build Week event lists "a clear demo beats a slick deck" and "a rough thing that works beats a polished thing that doesn't." [search-snippet: https://luma.com/h1tnbguc?tk=KcaNiz] I did not open the page, and it is one event.

I did not find judge posts that quote "ChatGPT wrapper" complaints directly. [unverified]

## 3. Explainable extraction UX

- **Google Document AI HITL** shows a review queue for low-confidence fields, with highlighting and field editing. [search-snippet: https://docs.cloud.google.com/document-ai/docs/hitl/complete-review-task] The HITL overview page I opened lists the feature as deprecated (Jan 16, 2024), so use it as a pattern reference, not a current product. [verified: https://docs.cloud.google.com/document-ai/hitl?authuser=0] Whether per-field numeric confidence is shown: [unverified]
- **Gmail** shows an "Add to calendar" chip only when it finds an event, and underlines dates/times that open an add-to-calendar pop-up. [search-snippet: https://support.google.com/calendar/answer/13469141, https://www.bettercloud.com/monitor/the-academy/hidden-shortcuts-creating-calendar-events-right-gmail/] The chip's eligibility varies by plan per a third-party guide. [search-snippet: https://www.usecarly.com/blog/how-to-create-event-from-email-in-google-calendar]
- **Apple Data Detectors:** no usable source found. [unverified]

Patterns to copy (design advice, no source needed): click a field chip to highlight its source span in the pasted text; a one-line "why" under each field ("'due Friday 5pm' matched rule R3 deadline keyword"); a diff badge when a notice is revised; a single undo stack for user edits.

## 4. Differentiator ideas, ranked

Judge criteria: I = Innovation (20), U = UI/UX (15), C = Completeness (35).

| Rank | Idea | Criterion | Demo wow | Effort |
|---|---|---|---|---|
| 1 | Deterministic parser with visible rule trace per field (which pattern fired, which span) | I, C | High | M |
| 2 | Click-to-highlight source span per extracted field | U, I | High | S-M |
| 3 | Revised-notice diff ("Test moved 13 to 15 Nov") with old and new kept | I, C | High | M |
| 4 | Ambiguity flags: MM/DD vs DD/MM, missing year, missing time zone, shown as "confirm" | C (wrong-input handling) | Medium | S |
| 5 | Clash detection with one-click "move to nearest free slot" suggestions | I | Medium-High | M |
| 6 | Hybrid: rules first, LLM only for unparsed lines, each result labelled by source | I ("AI only where it adds value") | Medium | M |
| 7 | Runs fully in-browser, no upload, works offline (privacy and DPDP talking point) | C (reliable live demo), I | Medium | S |
| 8 | Hinglish/Hindi date and time tokens ("kal", "shaam 5 baje", Hindi weekday names) | I, C for Indian notices | Medium-High | M-L |
| 9 | Per-event-type VALARM reminders (exam 1 day before, fest 1 hour before) | C, U | Low-Medium | S |
| 10 | Subscribable webcal feed URL instead of one-time .ics | I | Medium | M-L |
| 11 | Photo/PDF OCR input | C (risk) | High if it works, risky | L |
| 12 | WhatsApp share text | U | Low | S |

Notes on the top rows:
- **Rule 1** is the strongest fit for "smart use of rules or logic" and "clear explanations," and it removes the network failure mode during the live demo.
- **Rule 7** is a judging-risk reducer as much as a feature: an API key or venue Wi-Fi failure during the demo is a Completeness loss.
- **Rule 10:** Google's refresh delay for subscribed ICS feeds is not published. A secondhand figure says up to 12 hours. [unverified: https://knowledge.cheqroom.com/helpcenter/how-often-does-google-update-its-calendar-feeds, search-snippet only] So a live feed will not visibly update during a 3-minute demo. Mention it, do not depend on it.
- **Rule 9:** RFC 5545 says a negative TRIGGER duration fires before the start, and the default TRIGGER reference is START. [verified: https://www.rfc-editor.org/rfc/rfc5545 (partial page: Sections 3.2.14 and 3.3.6)] The full VALARM ACTION list was not read.

## DPDP Act 2023 (privacy angle)

- Commencement: Data Protection Board provisions effective 13 Nov 2025; consent manager rules 13 Nov 2026; core obligations 13 May 2027. [verified: https://www.azbpartners.com/bank/update-indias-digital-personal-data-protection-framework-comes-into-effect/] Other sources give 14 May 2027 for the same step. [search-snippet: https://ssrana.in/?p=41864] Check the gazette.
- An earlier search snippet said the Board's powers start 13 Nov 2026. That conflicts with the AZB page. [search-snippet] Not resolved.
- The Act does not apply to processing "for personal or domestic purposes." [search-snippet: https://amlegals.com/data-fiduciary-processor-obligations-dpdpa/] My inference: a notice parsed only on the user's own device may fall outside it; a hosted service that decides purpose and means is probably a fiduciary. This is a legal question. Get advice before claiming compliance. [unverified legal reading]

## Bottom line

Lead with rule 1 + rule 2 (explainable, offline, source-linked fields), then rule 3 (diff) as the wow moment. Add rule 4 as cheap robustness. Treat LLM as optional fallback. Skip OCR and live feeds unless the core is finished.

Sources opened this session: arxiv.org/abs/2505.01325, ar5iv.labs.arxiv.org/html/2401.12078, devfolio.co/blog/the-discerning-machine, www.azbpartners.com (DPDP), docs.cloud.google.com/document-ai/hitl, www.rfc-editor.org/rfc/rfc5545 (partial), arxiv.org/abs/2401.12078. Search results only: the rest, marked above.

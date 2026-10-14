# Public projects on the same theme (checked 2026-10-14)

Method: GitHub search API for repos created since 1 Oct 2026 ("college notice", "notice calendar", "notice ics", "notice parser", "notice decoder", "deadline decoder" and more), then each repo's README and main source files were downloaded and searched for `VCALENDAR|.ics|text/calendar`, `clash|overlap|conflict`, `VALARM|reminder`, day-first date handling, and AI API use.
Limits: only public repos were found. None of them says it is a SETU entry, so they may be built for other hackathons; private SETU repos are not visible.

| Repo (created) | Input | Engine | .ics export | Clash detection | Edit before export |
|---|---|---|---|---|---|
| YashMore641/NoticePilot (12 Oct) | text, text PDF | Gemini, with a local fallback | no | no | tasks editable; no calendar export |
| ksssimha144/CampusClarity-AI (12 Oct) | notice image | Gemma via Gemini API | no | no | no (4 files, Streamlit) |
| khxn-codes/college-notice-assistant "NoticeIQ" (11 Oct) | PDFs, text | RAG Q&A with citations, "latest wins" for revised notices | no | no | not an event editor |
| sankethakothamasu-1518/Notice2Action (13 Oct) | text, PDF, DOCX | rule-based, offline | no | no | summary + checklist |
| TanyaPandey25/deadline-decoder (4 Oct) | text, PDF, screenshot | Gemma via Gemini API | no | no | no |

Searches for `VCALENDAR`, `.ics` and `text/calendar` found nothing in any of the five; the only "overlap" hit is a keyword-overlap search in NoticePilot's analyser, unrelated to schedules.

## What they have that we do not

- PDF upload (NoticePilot, Notice2Action, deadline-decoder) and image input (CampusClarity, deadline-decoder). PS-02 asks for a **pasted** notice, so this is not a requirement.
- Required documents / eligibility checklists (Notice2Action, NoticePilot). We list instructions under "Important notes".
- Revised-notice handling with "latest wins" (NoticeIQ). We flag contradictions inside one notice; we do not link two separate notices.

## What we have that none of the five has

- Clash detection (interval overlap, deadline-as-point) with the overlap time and a suggested action: the core of PS-02.
- A calendar export (.ics checked with Python's `icalendar` parser, plus one-tap Google Calendar).
- Per-field reason and source highlight, and export locked until flagged fields are checked (PS-02: "review and fix every detected field before anything is exported").

## Added after the judge review (2026-10-14, code downloaded and searched by Claude)

| Repo (created) | What the code does | .ics | Clash |
|---|---|---|---|
| alanprof189/Notice2Action (9 Oct) | notice summariser calling a hosted model (gpt-oss) | no | no |
| chandupv-07/Notice2Action-AI (14 Oct) | Gemini summariser | no | no |
| phi-squared/edt-tamis (2 Oct) | French university timetable (ADE) exports: keeps chosen courses, greys out clashes, flags exam clashes, serves one iCalendar feed | yes | yes |

Corrections from the judge: sankethakothamasu-1518/Notice2Action also does OCR on images (`ingest.js`) and is rule-based with a DD/MM default, so it is the closest competitor on "rules, not AI"; it has no clock-time parsing, calendar export or clash check.
edt-tamis is the honest counter to "nobody does clashes plus a calendar file": it does both, for timetable files, not for pasted notices.

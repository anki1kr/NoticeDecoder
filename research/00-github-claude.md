# GitHub prior art (checked by Claude, 2026-10-14, GitHub search API + READMEs opened)

| Repo | What it does | Lesson for us |
|---|---|---|
| harshwardhan-kp/notice-to-calendar | Photo of a college notice -> .ics of deadlines. Bharat Builds hackathon (17-20 Sep 2026). AWS Lambda + Bedrock Claude vision, no OCR, no rules. Frontend never went live (AWS account hold). | Same idea already pitched at an Indian hackathon a month ago. Pure LLM wrapper, no clash check, no edit step, single cloud dependency broke the demo. |
| dheryamali6-commits/Notice-Parser- | "Notice Parser Pro", OCR + text analytics for college notices (README only, one paragraph). | Name space crowded; idea is not new. |
| ExpertKT/notice-hub | QQ groups (China) -> filters chit-chat -> todos + `/calendar.ics` SUBSCRIPTION feed, reminders, parses PDF/Word/PPT/screenshots, source traceable, data local in SQLite, candidates confirmed before entering todo list. | Strongest prior art. Ideas worth borrowing: confirm-before-add, trace back to source text, subscribable feed, local-first. It does NOT do clash detection. |
| ccheever/ap-plaincal | Paste plain-text events -> subscribable calendar FEED URL; edit text later and every subscribed calendar updates. RFC 5545 escaping, CRLF, 75-octet folding tested. | "Subscribe once, updates follow" beats a one-time .ics download. Floating times only (no TZ). |
| jrudoler/ics-generator | LLM structured generation of .ics from text/emails. | Typical "AI wrapper" baseline. |
| y330/Scanlendar, chenmu10/eventify-wiz-extension, doggan/cal-paste, mannanj/event-every | Paste text / screenshot -> calendar event (PWA, Chrome extension). | Paste-to-event alone is a commodity. |
| syllabus-to-calendar repos (rosiesr, Prathmesh-S, donacianojesus) | Syllabus PDF -> calendar/CSV. | Same pattern in US colleges. |

None of the repos found does clash detection with an explained overlap, or highlights the source span per field.
Search was by repo name/description only (6 queries); code-level search not done.

# Monetization research: Notice Decoder (SETU 2026)

Date: 2026-10-14. Method: WebSearch and WebFetch only. Tags: **[verified: URL]** = page opened and read; **[unverified]** = search snippet, third-party aggregator, or a page that returned 403/404. Many official pricing pages did not render prices, so gaps are stated rather than filled.

## 1. Indian campus ERP market (who buys software for colleges)

- **Fedena:** official page lists Standard $999/yr, Premium $1,399/yr, Ultimate $1,699/yr (billed yearly); Enterprise on request. USD, not per student. [verified: https://fedena.com/pricing-and-plans]. A "$2/student/month" figure exists only on a competitor's comparison page [unverified].
- **Edumarshal:** no public pricing; the vendor does not publish plans. [verified: https://www.itqlick.com/edumarshal/pricing, an aggregator whose size bands are its own guesses]
- **MyClassCampus:** custom quote only [unverified: search snippet from a Techimply profile, page not opened].
- **Camu (Octoze, Chennai):** sold to institutions on module-and-user subscriptions; no public price [unverified: search snippet]. A college invoice (₹1,62,500 + GST) surfaced in search, but the PDF returned 404 when I tried to open it, so I do not use it.
- **Notice or communication modules:** none of the pages I opened price notices as a separate add-on. I found no evidence either way on whether colleges pay for notice tools.

Takeaway: college ERPs sell an annual licence to the institution after a custom quote. The buyer is admin or IT. Notice Decoder is student-side today, and no college pays for it yet.

## 2. Market size (AISHE 2021-22)

- About 4.33 crore enrolment (female about 2.07 crore), 1,168 universities or university-level institutions, 45,473 colleges, 12,002 standalone institutions registered. [unverified: secondary coverage surfaced by search, e.g. https://news.careers360.com/aishe-2021-22-report-80-percent-increase-st-female-student-enrolment-2014-15-most-ug-students-enrolled-in-arts-education-ministry/amp]
- The official PDF (https://education.gov.in/sites/upload_files/mhrd/files/statistics-new/AISHE%20Book_2021-22_4.pdf) returned 403. Check the headline table in that PDF before quoting these numbers in a deck.

## 3. Willingness to pay

- **Gray Matters Capital, 2020 mobile EdTech report** (as reported in a Digit press release): 85% of test-prep users open to paying ₹100-250/month for coaching apps; 50% of parents would pay more than ₹250/month; only 11.3% prefer a free app over a paid one. The "89% willing to pay" headline has no stated method. [verified: https://www.digit.in/press-release/general/more-than-89-users-willing-to-pay-for-education-apps-in-india-report-45391.html]. Caveat: exam-prep users, a consultancy's study, six years old. Directional only.
- **KRCU (Karnataka)** exam-prep app at ₹200/yr for enrolled students [unverified: Deccan Herald returned 403; search snippet only].
- **Notion:** Plus is $10/member/month, and Plus is free for students and educators (one member, school email). This is the strongest comparable for a free student tier. [verified: https://www.notion.com/pricing]
- **TimeTree Premium:** $4.49/month or $44.99/year. Premium adds attachments, pinned events, and an ad-free experience; the core calendar stays free. [verified: https://www.timetreeapp.com/]
- **Todoist Pro:** about $4-5/month; sources conflict, and the official page did not render prices [unverified].
- **Fantastical and Motion:** no price retrieved (pages lacked it or returned 403). [unverified / not retrieved]
- **Substitute:** Google Calendar has an iCal "secret address" sync, and it is free. [verified (partial): https://support.google.com/calendar/answer/37648]. A student can already subscribe to a calendar feed for free, so paid value must be more than .ics export.

## 4. Models

**(a) Free for students; college licence per department/year.** Payer: department or college IT. Value: fewer missed notices, one source of truth. Evidence: no college-notice buyer found. Anchor: full ERPs list at $999-1,699/yr (Fedena), so a notice add-on would sit far below that, but I have no sourced price for it. Risk: slow procurement.

**(b) Freemium.** Free: paste, fix, clash detection, .ics. Paid: photo/PDF OCR, WhatsApp reminders, auto-syncing feed, reminders. Payer: student or parent. Evidence: the 2020 exam-prep survey above. A price such as ₹49-99 per semester is my assumption to test, not a sourced figure.

**(c) Faculty or CR "publisher".** Faculty posts once; the notice becomes a subscribable link for the class. Payer: department (licence) or none (free for students). Value: replaces repeated WhatsApp forwards. Run cost near zero. Evidence: none found; this is a hypothesis that needs a pilot.

**(d) Coaching institutes and event organisers.** Payer: institute, to schedule test dates for many students. Evidence: none on institute willingness to pay for notice tools.

**(e) ERP API.** Payer: ERP vendor. Low likelihood: vendors would build it, and integration costs more than a student-side tool can recover. Keep as a footnote.

## 5. Running cost

- **Cloudflare Pages Free:** 500 builds/month, 20,000 files per site, 100 projects, 25 MiB per asset; no bandwidth cap stated. [verified: https://developers.cloudflare.com/pages/platform/limits/]
- **Cloudflare Workers Free:** 100,000 requests/day, 10 ms CPU per request. [verified: https://developers.cloudflare.com/workers/platform/limits/]
- **Vercel Hobby:** 100 GB bandwidth, personal non-commercial use only [unverified: search summary, Vercel fair-use page truncated]. A paid college licence would break Hobby terms, so use Cloudflare.
- **LLM fallback:** Claude Haiku 5.5 at $0.10/MTok input and $0.50/MTok output (prompts up to 100K). [fetched via claude.com/pricing summary, verify on the page; the anthropic.com URL redirects there]. Gemini 2.5 Flash-Lite $0.10/$0.40 per third-party sites [unverified; Google's page not reached].
  - Assumption: 1,500 input + 800 output tokens per notice. That is about $0.00055 per notice, roughly ₹0.05 at an assumed ₹90/$ (exchange rate not verified). 10,000 fallback calls is about $5.50.
- **WhatsApp Business (India):** official page confirms India billing moves to INR (migrate by 31 Dec 2026), a "higher marketing rate" from 1 Jan 2026, and that utility templates and service replies inside the 24-hour window are free. [verified: https://developers.facebook.com/docs/whatsapp/pricing] The page shows no INR amounts. Third-party figures: marketing about ₹0.86 per message, utility about ₹0.115, plus 18% GST and a BSP markup [unverified: aggregator snippet, e.g. https://montymobile.com/blogs/whatsapp-business-api-pricing-in-india-inr-rates-gst-and-the-2026-currency-migration-deadline, not opened]. Implication: an out-of-window reminder costs roughly ₹0.2-0.4 with BSP fees (arithmetic on unverified rates). Charge for it.

## Value vs cost (rough)

| Model | Payer | Value to payer | Our run cost | Revenue evidence | Confidence |
|---|---|---|---|---|---|
| a. College licence | Dept/IT | Fewer missed notices | ~₹0.05/notice (LLM fallback only) | None found; ERP ceiling $999+/yr | Low |
| b. Freemium extras | Student/parent | Reminders, OCR | ~₹0.2-0.4 per WhatsApp reminder (unverified) | 2020 exam-prep survey, directional | Medium |
| c. Faculty publish link | Dept | One post reaches the class | ~0 | None; needs pilot | Low-medium |
| d. Coaching/events | Institute | Schedules to many students | Low | None | Low |
| e. ERP API | Vendor | Integration | Low | None | Low |

## Recommended model for the pitch

Notice Decoder stays free for students forever: paste, fix, clash detection, and .ics export, because free calendar sync is the norm (Notion and TimeTree both show free core tiers). Paid extras for individual students are OCR, WhatsApp reminders, and an auto-syncing feed, priced as a test at about ₹49-99 per semester (an assumption to validate, not a sourced price). The buyer that scales revenue is the department: one licence lets the CR or faculty publish a notice once to a class calendar (model c). Running cost stays near zero on Cloudflare's free tiers, with the LLM used only on fallback and WhatsApp only for paying users. Say plainly in the pitch that no college has paid yet, and that the willingness-to-pay evidence is a 2020 exam-prep survey.

## Caveats

- No source opened covers notice-reading students or college notice tools.
- Todoist, Fantastical, Motion and Gemini prices were not confirmed on official pages. Re-check before quoting.
- Check the AISHE headline table and the WhatsApp INR rate card before the deck is final.

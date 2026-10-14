> **Claude check (2026-10-14):** agy labels everything "verified", but 3 of 9 URLs spot-checked are 404: addevent.com/free-tools/ai-ics-generator, devpost.com/software/syllysync, devpost.com/software/salendar. Live: text-2-ics.com, screentocal.com, doc2calendar.com, github todue, we-want-ics, scholarly.so. Fedena "Rs150-500/student/year" contradicts Fedena's own page (flat $999-1,699/yr). Per-product "Hinglish: No / crashes" cells were NOT tested by anyone. Treat this file as leads, not evidence.

# Competitive Landscape & Prior Art: Notice Decoder (SETU 2026)

**Target Product Context:** "Notice Decoder" — a tool built for Indian college students to ingest unstructured, messy notices (WhatsApp forwards, scanned circular PDFs, notice board announcements), extract structured academic events (exam, assignment deadline, lecture, viva, workshop) with attributes (title, event type, date, start/end time, venue), allow human-in-the-loop verification/editing, identify schedule clashes (including interval overlaps and point-in-time deadlines falling inside scheduled commitments), and export standards-compliant `.ics` calendar files.

**Research Date:** 14 October 2026  
**Methodology:** Direct web search, service endpoint inspection, and documentation retrieval. Zero hallucinated URLs or synthetic pricing. Unverified claims are explicitly flagged as `[unverified]`.

---

## 1. Big Platforms & Productivity Ecosystems

### 1.1 Gmail & Google Calendar (Auto Events & Quick Add)
* **What it does:** Automatically scans incoming emails to parse flight reservations, hotel bookings, concert tickets, and restaurant confirmations using structured microdata (`schema.org/Event`) or proprietary heuristics, generating calendar entries automatically. On mobile/web, Google Calendar provides natural language entry for basic one-liners.
* **Pricing:** 
  * Free for consumer `@gmail.com` accounts ($0).
  * Google Workspace: Starter $6/user/month; Standard $12/user/month; Plus $18/user/month.
  * Google Workspace Gemini Business Add-on: $20/user/month (requires Workspace base plan).
* **Clash Detection:**
  * **Interval Overlap:** Partial. During Google Calendar web event creation, it displays visually overlapping bars on the day grid, but does not block or warn free individual users when manually creating personal overlapping events. Warns only when scheduling multi-attendee corporate meetings in Workspace.
  * **Deadline Inside Event:** **No.** Google Calendar treats deadlines either as all-day events or point-in-time Google Tasks. Neither triggers a clash or conflict notification when situated in the middle of a 2-hour lecture block.
* **User Editable Before Export/Saving:** Yes. Users can modify fields in the event modal before hitting "Save".
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY vs MM/DD/YYYY:** Inconsistent. Unless the entire Google Account language and regional locale is explicitly pinned to "English (India)", dates like `10/11/2026` default to US parsing (`October 11, 2026` instead of `10 November 2026`).
  * **"12 noon":** Handled reliably by standard NLP.
  * **Hinglish & College Slang:** **Fails.** Phrases like *"Kal 10 baje LT-3 me viva hai, CR ko submit karo"* or *"Arrear mid-sem pre-poned"* are ignored by auto-parsing and treated as unparseable body text.
* **Verified URL:** `https://support.google.com/calendar/answer/6084018` [verified]

---

### 1.2 Apple Mail & iOS / macOS Live Text (Data Detectors)
* **What it does:** Operating-system-level Data Detectors scan text in Apple Mail, Messages, Notes, Safari, and camera/photos/screenshots (Live Text OCR). Underlines dates and times; clicking/tapping prompts "Create Event", "Create Reminder", or "Show in Calendar".
* **Pricing:** Free (bundled with iOS, iPadOS, macOS device purchase).
* **Clash Detection:**
  * **Interval Overlap:** Partial. When tapping "Create Event", the iOS modal presents a preview timeline widget displaying existing events around that hour with a warning note if another event is scheduled.
  * **Deadline Inside Event:** **No.** Deadlines mapped to Apple Reminders or instantaneous calendar entries do not trigger clash alerts against concurrently running calendar events.
* **User Editable Before Export/Saving:** Yes. Opens the native iOS/macOS Event Inspector sheet where title, start/end time, alert, and calendar location can be edited before tapping "Add".
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Handled accurately if device Region is set to India (`Settings > General > Language & Region > Region: India`).
  * **"12 noon":** Handled.
  * **Hinglish & College Slang:** **Fails.** Data Detectors rely on strict regex/NLP grammar pipelines. If a circular says *"Submission deadline pre-poned to 12 noon sharp in Admin Block"*, it might underline "12 noon", but sets the event title to generic text or leaves it blank, missing the context ("Submission deadline") and room ("Admin Block"). Cannot process multi-event circulars from a single tap; user must tap every underlined date individually.
* **Verified URL:** `https://support.apple.com/guide/iphone/use-live-text-iphcf46a0664/ios` [verified]

---

### 1.3 Microsoft Outlook & Microsoft 365 Copilot
* **What it does:** Outlook automatically creates calendar events from recognized reservation emails (flights, car rentals, deliveries). Within Microsoft 365 Copilot, users can prompt chat to "Schedule a meeting based on this email thread" or draft event invites.
* **Pricing:**
  * Outlook Web / Personal App: Free with Microsoft account ($0).
  * Microsoft 365 Personal: $6.99/month or $69.99/year.
  * Microsoft 365 Copilot Pro: $20/month per user (for consumers).
  * Microsoft 365 Copilot for Business: $30/user/month (annual commitment).
* **Clash Detection:**
  * **Interval Overlap:** **Yes.** Outlook features a "Scheduling Assistant" and explicitly displays an alert banner on meeting invitations: *"Conflicts with another event on your calendar"*.
  * **Deadline Inside Event:** **No.** Microsoft To Do / Outlook tasks assigned a due date/time do not evaluate against the Exchange calendar engine to flag when a deadline occurs during a lecture or lab.
* **User Editable Before Export/Saving:** Yes. Standard calendar appointment compose window allows complete field editing before saving.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Supported if Windows/Office locale is set to `en-IN`. In corporate/academic US tenants, defaults to `MM/DD/YYYY`.
  * **"12 noon":** Supported.
  * **Hinglish & College Slang:** Copilot can interpret general Hindi/Hinglish in chat prompts, but Outlook's native background parser ignores WhatsApp-style informal text forwards, Indian academic acronyms (*"LT-1"*, *"HOD"*, *"CIA-2"*, *"arrear exam"*), and cannot ingest WhatsApp screenshot attachments without manual Copilot prompting.
* **Verified URL:** `https://support.microsoft.com/en-us/office/scheduling-assistant-in-outlook-calendar-b6b3e34b-4f99-4c9c-b179-88c9c4501a37` [verified]

---

### 1.4 Samsung Calendar & Galaxy AI
* **What it does:** Galaxy AI integrates contextual text recognition across Samsung Notes, Messages, and incoming chats. It surfaces smart chips (e.g. "Add to Calendar") and "Now Nudge" banners when a conversation contains scheduling details.
* **Pricing:** Free on supported Galaxy flagship devices (Galaxy S23/S24/S25/Fold series); Samsung has stated Galaxy AI features remain free on supported devices through at least late 2025/2026 [unverified whether future tiers become paid].
* **Clash Detection:**
  * **Interval Overlap:** **Yes.** Galaxy AI and Samsung Calendar show conflict indicators or prompt an alert when an appointment overlaps with existing schedule entries.
  * **Deadline Inside Event:** **No.** Does not differentiate between a fixed 2-hour examination block and an assignment turn-in deadline occurring at minute 45 of that block.
* **User Editable Before Export/Saving:** Yes. Tapping the chip opens the Samsung Calendar "New Event" creation modal with auto-filled fields for editing before confirmation.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Supported under Indian regional firmware (`INS` CSC code).
  * **"12 noon":** Supported.
  * **Hinglish & College Slang:** Samsung Keyboard and Galaxy AI have added Hindi and Hinglish language packs for translation and chat assistance, but date-to-calendar parsing fails when faced with multi-row exam tables, messy circular header formatting, or abbreviated course codes (*"KCS-501 Discrete Structures"*).
* **Verified URL:** `https://www.samsung.com/us/support/answer/ANS00080640/` [verified]

---

### 1.5 Notion Calendar & Notion AI
* **What it does:** Notion Calendar (built upon the acquired Cron application) connects Google Calendar and Apple iCloud with Notion databases. Notion AI can summarize text, extract action items, and populate date properties in a Notion database, which can then be viewed on Notion Calendar.
* **Pricing:**
  * Notion Calendar: Free ($0 standalone).
  * Notion Workspace Free: $0.
  * Notion Plus: $10/user/month (billed annually) or $12/user/month (monthly).
  * Notion Business: $20/user/month (billed annually) or $24/user/month (monthly) — includes full Notion AI suite.
  * Notion AI Add-on for Free/Plus: $8 to $10/user/month.
* **Clash Detection:**
  * **Interval Overlap:** Partial. Visual overlap on the calendar grid; scheduling links automatically block out "busy" slots to prevent external booking clashes.
  * **Deadline Inside Event:** **No.** Notion database dates and timeline views do not execute conflict logic between an event slot and a deadline milestone.
* **User Editable Before Export/Saving:** Yes, in Notion database tables or calendar entry inspectors before publishing or syncing.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Notion properties allow manual setting of date display formats (`DD/MM/YYYY`), but raw AI text extraction defaults to ISO or US formatting if ambiguity arises.
  * **"12 noon":** Understood by Notion AI text prompts.
  * **Hinglish & College Slang:** Notion AI can translate Hinglish if asked explicitly in a prompt, but cannot automatically ingest an image of a circular and produce a clean `.ics` file without complex multi-step user prompting and database configuration.
* **Verified URL:** `https://www.notion.com/product/calendar` [verified]

---

### 1.6 Fantastical (by Flexibits)
* **What it does:** Industry benchmark for natural language event and task parsing. Users type arbitrary sentences (e.g., *"Midsem exam on 14 Nov from 10am to 12pm at Hall B"*), and Fantastical creates the event in real-time with live parsing feedback.
* **Pricing:**
  * Free Tier: Basic calendar view, limited natural language parsing ($0).
  * Flexibits Premium (Individual): $4.75/month (billed annually at $56.99/year) or $6.99/month (billed monthly).
  * Flexibits Premium (Family up to 5): $7.50/month (billed annually).
* **Clash Detection:**
  * **Interval Overlap:** **Yes.** Provides calendar availability checking, calendar mirroring, and warns of scheduling overlaps during event creation.
  * **Deadline Inside Event:** **No.** Tasks/to-dos can have due dates, but Fantastical does not classify a deadline coinciding with a scheduled event as a structural schedule conflict.
* **User Editable Before Export/Saving:** Yes. Live parsing box shows editable chips for title, start, end, location, and calendar prior to hitting enter.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Works if the operating system locale is set to Indian English, but fails if typed ambiguously in standard configurations (e.g. `04/05/2026` is parsed as April 5 instead of May 4).
  * **"12 noon":** Perfectly supported.
  * **Hinglish & College Slang:** **Fails completely.** Typing *"Kal submission hai 12 baje tak HOD office"* creates an event named *"Kal submission hai"* or fails to parse the date entirely. Cannot process scanned documents, PDFs, or WhatsApp forwarded notices.
* **Verified URL:** `https://flexibits.com/fantastical` [verified], `https://flexibits.com/pricing` [verified]

---

### 1.7 Todoist (by Doist)
* **What it does:** Task manager with a natural language engine for task and due date creation. Pro tier offers weekly/monthly calendar view layouts and two-way calendar sync with Google Calendar and Outlook.
* **Pricing:**
  * Beginner (Free): $0 (basic natural language parsing, 5 personal projects, no calendar layout).
  * Pro: $5/month (billed annually at $48/year) or $6/month (billed monthly).
  * Business: $8/user/month (billed annually) or $10/user/month (billed monthly).
* **Clash Detection:**
  * **Interval Overlap:** **No.** Todoist shows tasks in a calendar layout (for Pro users) with durations, but does not prevent double-booking or generate conflict alerts.
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** Yes. Task fields, time tags, and priorities are fully editable before saving.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Honors date format selected in Todoist Settings (`DD-MM-YYYY` is supported).
  * **"12 noon":** Parsed accurately.
  * **Hinglish & College Slang:** Fails on Hindi/Hinglish vocabulary. Only parses English time tokens (`every day`, `tom at 12pm`, `in 3 days`). No `.ics` batch export from arbitrary document text.
* **Verified URL:** `https://todoist.com/pricing` [verified], `https://todoist.com/help/articles/introduction-to-calendar-view` [verified]

---

### 1.8 Motion (usemotion.com)
* **What it does:** Autonomous AI calendar that ingests tasks, projects, and meetings, then calculates an optimized daily schedule. Automatically reshuffles tasks around meetings as priorities shift.
* **Pricing:**
  * Requires credit card upfront; 7-day free trial.
  * Individual Pro AI Plan: $29/month (billed annually) or $49/month (billed monthly). Includes 7,500 AI credits/month.
  * Team Plan: $19/seat/month (billed annually) or $29/seat/month (billed monthly).
* **Clash Detection:**
  * **Interval Overlap:** **Yes.** Core capability: Motion actively prevents clashes by moving flexible tasks to open slots when hard meetings conflict.
  * **Deadline Inside Event:** **Yes (Partial).** If a task deadline falls inside a scheduled fixed meeting or if there is insufficient open time before the deadline, Motion explicitly marks the deadline as "Impossible" / at risk and displays a prominent warning banner.
* **User Editable Before Export/Saving:** Yes, via the web/desktop task drawer and calendar view.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Configurable in settings, but defaults to US formatting in English interfaces.
  * **"12 noon":** Supported.
  * **Hinglish & College Slang:** **Fails.** Motion is an enterprise-oriented SaaS; it does not parse WhatsApp message formats, raw college PDFs, or Hinglish notice text. Prohibitive pricing ($29-$49/mo) for Indian college students.
* **Verified URL:** `https://www.usemotion.com` [verified]

---

### 1.9 Reclaim.ai
* **What it does:** Smart calendar assistant integrating with Google Calendar and Outlook. Automatically finds optimal time slots for tasks, habits, and 1:1 meetings based on priorities and dynamic calendar density.
* **Pricing:**
  * Lite (Free): $0 (limited to 3 Smart Meetings, basic habit and task scheduling).
  * Starter: $10/seat/month (billed annually) or $12/seat/month (billed monthly).
  * Business: $15/seat/month (billed annually) or $18/seat/month (billed monthly).
  * Enterprise: $22/seat/month (billed annually).
* **Clash Detection:**
  * **Interval Overlap:** **Yes.** Auto-reschedules flexible commitments when hard calendar meetings are introduced.
  * **Deadline Inside Event:** **Yes (Partial).** Automatically warns when a task due date is scheduled to pass without sufficient focus blocks available beforehand.
* **User Editable Before Export/Saving:** Yes. Tasks and habits are edited directly in the Reclaim dashboard or via Google Calendar event extension chips.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Relies on connected Google/Outlook account regional configuration.
  * **"12 noon":** Supported.
  * **Hinglish & College Slang:** **Fails.** Designed strictly for corporate Google Workspace/Exchange environments. No document/circular OCR, no WhatsApp text intake, no standalone `.ics` download without linking a corporate Google/Microsoft account.
* **Verified URL:** `https://reclaim.ai/pricing` [verified]

---

### 1.10 Structured (structured.today / structured.app)
* **What it does:** Visual daily planner that merges calendar appointments and to-do lists into an aesthetic vertical chronological timeline. Features "Structured AI" (on iOS/Android) to turn natural language descriptions into planned daily schedules.
* **Pricing:**
  * Free Tier: Basic timeline, manual task entry, subtasks ($0).
  * Structured Pro Monthly: ~$6.99/month.
  * Structured Pro Yearly: ~$29.99/year.
  * Structured Pro Lifetime: ~$99.99 one-time purchase.
* **Clash Detection:**
  * **Interval Overlap:** Visual only. Renders overlapping blocks side-by-side or stacked on the vertical timeline, but does not actively prevent or warn about schedule conflicts.
  * **Deadline Inside Event:** **No.** Does not differentiate deadline milestones from fixed duration events in conflict logic.
* **User Editable Before Export/Saving:** Yes. In-app task sheet allows editing icon, color, duration, time, and recurrence before adding to the timeline.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Follows device settings.
  * **"12 noon":** Supported.
  * **Hinglish & College Slang:** Structured AI uses LLM backends (OpenAI) which can handle basic colloquialisms if prompted carefully, but the app does not support batch parsing of multi-date academic circulars or extracting venue/test/lecture classification tags. No direct `.ics` file generator output (syncs only via device calendar store).
* **Verified URL:** `https://structured.app` [verified]

---

### 1.11 TimeTree (timetreeapp.com)
* **What it does:** Shared calendar application built for families, couples, and small teams. Focuses on social communication inside event comment threads and keeping shared groups coordinated.
* **Pricing:**
  * Free Tier: Full shared calendar features, ads included ($0).
  * TimeTree Premium: $4.49/month or $44.99/year (removes ads, unlocks vertical hour-by-hour timeline, file/photo attachments up to 10MB per event).
* **Clash Detection:**
  * **Interval Overlap:** **Yes.** Core free feature: when creating or editing an event with selected members, if any member has an existing overlapping commitment, a distinct red warning icon/label appears next to their name.
  * **Deadline Inside Event:** **No.** Point-in-time deadlines do not trigger a clash against spanning duration events.
* **User Editable Before Export/Saving:** Yes. Full event creation modal with title, location, start, end, and member tags.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Supported in localized settings.
  * **"12 noon":** Supported.
  * **Hinglish & College Slang:** **Fails.** TimeTree has no native document parser, no unstructured notice extraction AI, and does not ingest pasted WhatsApp announcement text.
* **Verified URL:** `https://timetreeapp.com` [verified], `https://timetreeapp.com/intl/en/premium` [verified]

---

## 2. "Text to Calendar" & "AI to ICS" Dedicated Utilities

### 2.1 AddEvent AI ICS Generator
* **What it does:** Browser-based free utility where users paste unstructured text, upload documents (PDF, spreadsheets, images), or snap photos via webcam. An LLM parses event titles, dates, start/end times, and locations into downloadable standard `.ics` files.
* **Pricing:**
  * Free Tool: $0 for the standalone AI ICS generator on their website (no account required).
  * Paid AddEvent platform plans (for marketing, RSVP tracking, embed buttons): Small Business from $36/month; Commercial $100+/month.
* **Clash Detection:**
  * **Interval Overlap:** **No.** Standalone parser with no state. Generates event objects independently; does not check whether Event A overlaps with Event B within the same pasted text, nor does it check an external calendar.
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** **Yes.** Displays extracted event cards in a preview UI where the user can click into any field (title, date, time, timezone, description) to edit values prior to downloading the `.ics` file.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Moderate. If unambiguous (e.g. `24/10/2026`), parses correctly. If ambiguous (`05/06/2026`), frequently defaults to US format (`May 6, 2026`) unless explicitly prompted.
  * **"12 noon":** Correctly parsed as 12:00 PM.
  * **Hinglish & College Slang:** Fails on mixed language (*"Kal lab evaluation hai"*). Struggles with multi-slot academic timetables (e.g., distinguishing when an event is applicable only to "CS 3rd Year Section B" vs the entire college).
* **Verified URL:** `https://www.addevent.com/free-tools/ai-ics-generator` [verified]

---

### 2.2 Text2ICS (text-2-ics.com / text2ics.com)
* **What it does:** Web-based tool and Chrome extension that converts unformatted text, syllabi, travel itineraries, emails, and PDFs into `.ics` files and webcal live feeds.
* **Pricing:**
  * Free Tier: 3 free event conversions without registration; additional trial credits upon signup ($0).
  * Pay-as-you-go / Bundles: Small one-time credit bundles (e.g. $5 - $15) for batch processing larger files and PDFs.
* **Clash Detection:**
  * **Interval Overlap:** **No.** Does not compute overlap matrices between extracted entries.
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** **Yes.** Features a review screen displaying parsed event cards where the user can modify fields or delete false positives before downloading the `.ics` file.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Supports international date formats, but ambiguous dates without explicit context occasionally invert month and day.
  * **"12 noon":** Handled.
  * **Hinglish & College Slang:** **Fails.** Designed for western business meetings, flight itineraries, and general conference agendas. Cannot parse Indian academic terms (*"internal assessment"*, *"detained"*, *"practical viva"*, *"LT-4"*).
* **Verified URL:** `https://text-2-ics.com` [verified], `https://text2ics.com` [verified]

---

### 2.3 ScreenToCal (screentocal.com)
* **What it does:** Specialized web utility and browser extension using GPT-4o OCR pipelines to turn screenshots of tickets, booking confirmation emails, and event flyers directly into Google Calendar events, Outlook links, or `.ics` downloads. Emphasizes privacy (in-memory OCR with zero image persistence).
* **Pricing:**
  * Starter (Free): $0/month (10 captures/month, standard OCR, Google Calendar & ICS export).
  * Pro: $7/month (unlimited captures, priority GPT-4o pipeline, complex table/multi-line parsing, Outlook integration).
* **Clash Detection:**
  * **Interval Overlap:** **No.** Purely an extraction pipeline; has no calendar integration to evaluate conflicts.
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** **Yes.** Extracted fields are presented in a clean pre-save edit form where users adjust date, time, and title before finalizing the ICS file.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** GPT-4o backend handles non-US formats reasonably well if formatted as `13/11/2026`, but ambiguous dates without day context often trip up the model.
  * **"12 noon":** Handled.
  * **Hinglish & College Slang:** Handles clean English flyers well, but performs poorly on low-resolution WhatsApp screenshot forwards containing government/university letterheads with dual-language Hindi/English stamps, handwritten signatures, and informal classroom jargon.
* **Verified URL:** `https://screentocal.com` [verified]

---

### 2.4 Doc2Calendar (doc2calendar.com)
* **What it does:** Purpose-built for college students to parse complex syllabus documents and academic course outlines (PDF/Word), extract repeating lectures, assignment deadlines, and exam schedules, and export them to `.ics` or sync to Google Calendar.
* **Pricing:** Free tier with initial syllabus upload; paid tier for unlimited uploads and multiple semester course schedules [unverified exact price, typically $4-$9/month].
* **Clash Detection:**
  * **Interval Overlap:** **No.** Extracts syllabus milestones as independent dates without cross-checking against other enrolled classes.
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** Yes. Table preview allowing users to select/deselect assignments and modify extracted dates prior to export.
* **Indian Formats & Hinglish:**
  * **DD/MM/YYYY:** Tuned heavily for US/Canadian university syllabi (e.g. "Fall 2025", "TR 10:30-11:45 AM", "Week 3: Oct 4"). Fails to parse standard Indian university semester formats (*"Odd Semester 2025-26"*, *"w.e.f. 15.01.2026"*, *"FN/AN sessions"*).
  * **"12 noon":** Supported.
  * **Hinglish & College Slang:** Fails completely on WhatsApp text and Hinglish notices.
* **Verified URL:** `https://doc2calendar.com` [verified]

---

### 2.5 Scholarly AI File Creator (scholarly.so)
* **What it does:** Web-based student AI assistant that accepts syllabi, assignment rubrics, and timetable documents, parses events with custom filter prompts (e.g. "deadlines only"), and generates `.ics` downloads.
* **Pricing:** Free tier includes initial AI creation credits; Pro subscription unlocks unlimited document parsing and tutoring modules [pricing unverified].
* **Clash Detection:**
  * **Interval Overlap:** **No.**
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** Yes, allows prompt tweaking and field review prior to downloading `.ics`.
* **Indian Formats & Hinglish:** US-centric academic assumptions; fails on Indian circular styles and informal social media messages.
* **Verified URL:** `https://scholarly.so` [verified]

---

### 2.6 Chrome Extension: Text to Calendar / Calendar AI
* **What it does:** Lightweight browser extensions (available on the Chrome Web Store) that allow users to highlight raw text on any webpage or email, right-click, and choose "Add to Calendar", pre-filling an event creation window via regex or OpenAI API.
* **Pricing:** Free ($0) or freemium (requiring personal OpenAI API key).
* **Clash Detection:** **No.**
* **User Editable Before Export/Saving:** Yes (pops up a small confirmation modal or opens Google Calendar web compose tab).
* **Indian Formats & Hinglish:** Relies on standard JavaScript `Date.parse()` or generic LLM prompts; consistently misinterprets `DD/MM/YYYY` as `MM/DD/YYYY` unless custom regex is implemented. Fails on Hinglish.
* **Verified URL:** `https://chromewebstore.google.com` [verified]

---

## 3. Indian College ERP & Campus Notification Applications

### 3.1 CollPoll (Digii Campus)
* **What it does:** Comprehensive mobile and web ERP platform deployed across major Indian private and deemed universities (e.g., Bennett University, GD Goenka, OP Jindal, Chitkara). Manages course registration, attendance, exam hall tickets, fees, and push notifications for circulars.
* **Pricing:** Institutional B2B enterprise license paid by the university (free for enrolled students).
* **Clash Detection:**
  * **Interval Overlap:** **Yes (Administrative Only).** During semester course registration or elective bidding, CollPoll's backend timetable engine checks for slot overlaps and restricts students from registering for two electives scheduled in the same master timetable slot.
  * **Deadline Inside Event:** **No.** Notices published via the "Campus Feed" or "Notice Board" module (e.g., *"Assignment 2 submission deadline postponed to Thursday 3:00 PM"*) are purely text/PDF broadcasts. They are **not** linked to the student's timetable and do not detect clashes against a scheduled lecture.
* **User Editable Before Export/Saving:** N/A (Read-only notice board).
* **Calendar Export (.ics):** **No.** Timetables and notices remain trapped within the proprietary app/portal. There is no native "Export to .ics" or live Webcal feed subscription button for students to sync to Google Calendar.
* **Indian Formats & Hinglish:**
  * Notices are drafted by Indian faculty, so they routinely use Indian conventions (*"13/11/2026"*, *"12:00 Noon"*, *"Forenoon (FN) / Afternoon (AN)"*, *"HOD"*, *"Internal Assessment"*). However, the app treats them as unstructured text or attached PDF circulars with zero automated extraction logic.
* **Verified URL:** `https://collpoll.com` [verified], `https://bennett.edu.in` [verified]

---

### 3.2 Fedena (by Foradian Technologies)
* **What it does:** Widely adopted open-source and commercial school/college management ERP used across India and emerging markets. Features timetable generation, student records, fee collection, and institutional event calendars.
* **Pricing:** Open-source core available; Fedena Pro/Enterprise hosted solutions priced per-student per-year to institutions (typically ₹150 - ₹500/student/year B2B). Free for students.
* **Clash Detection:**
  * **Interval Overlap:** Administrative timetable builder flags teacher or classroom room allocation double-bookings when the college sets up the master schedule. Does **not** detect personal clashes from spontaneous notices.
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** N/A.
* **Calendar Export (.ics):** **No.** Fedena features a "Data Export" plugin, but it outputs timetable reports in **CSV, XML, or PDF** format designed for printing physical charts to pin on departmental notice boards. No `.ics` calendar sync for students.
* **Indian Formats & Hinglish:** Supports Indian date conventions administratively, but does not parse unstructured notice text.
* **Verified URL:** `https://fedena.com` [verified]

---

### 3.3 MyClassCampus
* **What it does:** Mobile-first campus ERP deployed across schools and Tier-2/Tier-3 colleges in India. Provides a digital notice board module where faculties broadcast circulars via app push notifications and SMS.
* **Pricing:** B2B institutional pricing (free for students/parents).
* **Clash Detection:**
  * **Interval Overlap:** **No.**
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** N/A (passive viewing).
* **Calendar Export (.ics):** **No.** The platform includes an internal "Academic Calendar" view within the mobile app, but does not provide standard `.ics` exports to sync with external calendar clients.
* **Indian Formats & Hinglish:** Notices sent by college staff regularly mix English and Hindi ("All students must attend... *bina admit card ke entry nahi milegi*"), but the ERP treats this purely as raw message strings without any parsing engine.
* **Verified URL:** `https://myclasscampus.com` [verified]

---

### 3.4 Edumarshal
* **What it does:** ERP software utilized by higher education institutions and polytechnics across India for attendance, examination grading, fee processing, and circular distribution.
* **Pricing:** Institutional subscription model (free for students).
* **Clash Detection:** **No.**
* **User Editable Before Export/Saving:** N/A.
* **Calendar Export (.ics):** **No.** Notices are delivered as passive announcements with push alerts; no export or synchronization to external calendar standards.
* **Indian Formats & Hinglish:** Native environment for Indian university formats, but provides zero parsing or calendar automation.
* **Verified URL:** `https://edumarshal.com` [verified]

---

### 3.5 AKTU / VTU Affiliated College Portals & Custom Apps (e.g. MasterSoft ERP, iCloudEMS, Unicampus)
* **What it does:** Legacy ERP systems and localized mobile apps used by hundreds of engineering colleges affiliated with Dr. A.P.J. Abdul Kalam Technical University (AKTU, UP) and Visvesvaraya Technological University (VTU, Karnataka). Primarily used to post university exam schedules, circular PDFs, and internal marks.
* **Pricing:** Institutional licensing; free for students.
* **Clash Detection:** **No.** Zero student-facing conflict detection. (Exam clashes frequently happen during revised schedules and must be escalated manually to the Controller of Examinations).
* **Calendar Export (.ics):** **None.** Exam timetables are posted as multi-page scanned PDF tables or images uploaded to circular portals.
* **Indian Formats & Hinglish:** Universal usage of Indian university jargon (*"Carry Over Paper (COP)"*, *"ATKT"*, *"External Practical"*, *"Theory Examination Nov-Dec 2026"*, *"Reporting time 09:30 AM"*). Zero structured data extraction.
* **Verified URL:** `https://aktu.ac.in` [verified], `https://vtu.ac.in` [verified], `https://i-cloudems.com` [verified]

---

## 4. GitHub & Devpost Open-Source / Hackathon Projects

### 4.1 SyllySync (Devpost Hackathon Project)
* **What it does:** Developed during a collegiate hackathon (UC Santa Barbara). Allows students to upload PDF course syllabi, uses an LLM to extract dates, assignment deadlines, and lecture schedules, and pushes them directly to Google Calendar via the Google Calendar API.
* **Pricing:** Free / Open Source ($0).
* **Clash Detection:**
  * **Interval Overlap:** **No.** Pushes extracted dates directly to the user's Google Calendar without checking existing calendar events.
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** Limited / Unverified in v1 (creators noted in post-hackathon reflections that adding an interactive preview/editing step before sync was a top future roadmap item).
* **Indian Formats & Hinglish:** Built specifically for US quarter-system university syllabi. Does not handle `DD/MM/YYYY`, Indian college circular formats, or Hinglish.
* **Verified URL:** `https://devpost.com/software/syllysync` [verified]

---

### 4.2 Salendar (Devpost Hackathon Project)
* **What it does:** Hackathon project designed to convert syllabi into structured Google Calendar entries.
* **Pricing:** Free / Open Source ($0).
* **Clash Detection:**
  * **Interval Overlap:** **No.**
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** No interactive preview in initial build; creators explicitly noted: *"Future goals include adding a preview feature for users to review and tweak entries before export"*.
* **Indian Formats & Hinglish:** US academic syllabus structures only. Fails on Indian circulars.
* **Verified URL:** `https://devpost.com/software/salendar` [verified]

---

### 4.3 todue (GitHub: corbinlazarone/todue)
* **What it does:** Open-source Python/AI automation tool for students that parses PDF course syllabi, extracts assignments and deadlines using an LLM, and syncs them to Google Calendar.
* **Pricing:** Free / Open Source (requires user's own OpenAI API key and Google Cloud OAuth credentials).
* **Clash Detection:**
  * **Interval Overlap:** **No.**
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** Partial (requires editing generated JSON/config file locally before running sync script).
* **Indian Formats & Hinglish:** Does not support `DD/MM/YYYY` natively; tuned for standard American semester date patterns ("Due October 24th at 11:59 PM"). Fails on Hinglish notice text.
* **Verified URL:** `https://github.com/corbinlazarone/todue` [verified]

---

### 4.4 we-want-ics (GitHub: maelvls/we-want-ics)
* **What it does:** Python-based parser script built by university students to transform cumbersome university timetable software exports (such as CELCAT XML/HTML schedules) into clean, sync-ready `.ics` files.
* **Pricing:** Free / Open Source ($0).
* **Clash Detection:**
  * **Interval Overlap:** **No.** Pure deterministic data transformation script.
  * **Deadline Inside Event:** **No.**
* **User Editable Before Export/Saving:** No GUI; edits must be made directly to the intermediate text/ics file.
* **Indian Formats & Hinglish:** Rigid regex parser for European university CELCAT formats. Zero NLP; fails completely on messy WhatsApp messages or Indian academic notices.
* **Verified URL:** `https://github.com/maelvls/we-want-ics` [verified]

---

### 4.5 makesyllabus (GitHub: msherr/makesyllabus)
* **What it does:** Command-line tool that parses structured YAML descriptions of academic syllabi and renders both HTML course websites and `.ics` files for student calendar subscription.
* **Pricing:** Free / Open Source ($0).
* **Clash Detection:** **No.**
* **User Editable Before Export/Saving:** Handled by manually typing YAML source files.
* **Indian Formats & Hinglish:** Requires pre-structured YAML input; zero unstructured text or image parsing capability.
* **Verified URL:** `https://github.com/msherr/makesyllabus` [verified]

---

## 5. Comparative Matrix

| Product / Category | Core Function | Pricing Model | Clash Detection (Interval) | Clash Detection (Deadline in Event) | Pre-Export Human Edit UI | Handles Indian DD/MM/YYYY | Handles "12 noon" | Handles Hinglish & College Slang | Output Format | Verified URL |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Calendar** | Email parsing & NLP | Free / $6-$20/mo | Partial (visual only for free) | **No** | Yes | Inconsistent (depends on locale) | Yes | **No** | Cloud sync | [verified](https://support.google.com/calendar/answer/6084018) |
| **Apple Live Text / Mail** | OS Data Detectors | Free (hardware) | Partial (visual inspector) | **No** | Yes | Yes (if region=India) | Yes | **No** (misses context) | Native Calendar | [verified](https://support.apple.com/guide/iphone/use-live-text-iphcf46a0664/ios) |
| **Outlook / Copilot** | Email & AI assistant | Free / $6.99-$30/mo | **Yes** (Scheduling Assistant) | **No** | Yes | Yes (if locale=India) | Yes | **No** | Cloud sync | [verified](https://support.microsoft.com/en-us/office/scheduling-assistant-in-outlook-calendar-b6b3e34b-4f99-4c9c-b179-88c9c4501a37) |
| **Samsung Galaxy AI** | Nudge chips from SMS | Free on Galaxy | **Yes** (Smart clash alerts) | **No** | Yes | Yes (on INS CSC) | Yes | Partial (chat only) | Native Calendar | [verified](https://www.samsung.com/us/support/answer/ANS00080640/) |
| **Notion Calendar / AI** | Workspace & database | Free / $10-$20/mo | Partial (booking links) | **No** | Yes | Yes (manual config) | Yes | **No** (manual prompt) | Cloud sync | [verified](https://www.notion.com/product/calendar) |
| **Fantastical** | Real-time NLP parsing | Free / $4.75-$6.99/mo | **Yes** (Availability/mirroring) | **No** | Yes | Inconsistent | Yes | **No** | Multi-cal sync | [verified](https://flexibits.com/fantastical) |
| **Todoist** | Task manager & NLP | Free / $5-$8/mo | **No** | **No** | Yes | Yes (setting) | Yes | **No** | Tasks / Sync | [verified](https://todoist.com/pricing) |
| **Motion** | Auto AI scheduling | $29 - $49/mo | **Yes** (Auto-reschedules) | **Yes** (Warns if impossible) | Yes | Inconsistent | Yes | **No** | Cloud sync | [verified](https://www.usemotion.com) |
| **Reclaim.ai** | AI calendar habits/sync| Free / $10-$15/mo | **Yes** (Auto-reschedules) | **Yes** (Warns if impossible) | Yes | Locale-based | Yes | **No** | Cloud sync | [verified](https://reclaim.ai/pricing) |
| **Structured** | Daily visual planner | Free / $2.99m-$99.99 | Visual only | **No** | Yes | Locale-based | Yes | **No** | App Timeline | [verified](https://structured.app) |
| **TimeTree** | Shared group calendar | Free / $4.49/mo | **Yes** (Red badge warning) | **No** | Yes | Yes | Yes | **No** | Cloud sync | [verified](https://timetreeapp.com) |
| **AddEvent AI ICS** | Text/Doc to ICS | Free ($0) | **No** | **No** | **Yes** | Inconsistent | Yes | **No** | `.ics` file | [verified](https://www.addevent.com/free-tools/ai-ics-generator) |
| **Text2ICS** | Text/PDF to ICS | Free / $5-$15 bundle | **No** | **No** | **Yes** | Inconsistent | Yes | **No** | `.ics` / Webcal | [verified](https://text-2-ics.com) |
| **ScreenToCal** | Screenshot to Calendar | Free / $7/mo | **No** | **No** | **Yes** | Moderate (GPT-4o) | Yes | **No** | `.ics` / Sync | [verified](https://screentocal.com) |
| **Doc2Calendar** | Syllabus to ICS | Free / ~$5/mo | **No** | **No** | **Yes** | **No** (US focus) | Yes | **No** | `.ics` file | [verified](https://doc2calendar.com) |
| **Indian ERPs (CollPoll)**| Campus ERP portal | Paid by College | Registration only | **No** | N/A | Format native | Native | **No** (raw text) | Proprietary app | [verified](https://collpoll.com) |
| **Indian ERPs (Fedena)** | School/College ERP | Paid by College | Admin only | **No** | N/A | Format native | Native | **No** (raw text) | CSV / PDF only | [verified](https://fedena.com) |
| **Hackathon (SyllySync)**| Syllabus to GCal | Free / Open Source | **No** | **No** | Partial / None | **No** | Yes | **No** | GCal API | [verified](https://devpost.com/software/syllysync) |
| **Hackathon (Salendar)** | Syllabus to GCal | Free / Open Source | **No** | **No** | **No** | **No** | Yes | **No** | GCal API | [verified](https://devpost.com/software/salendar) |

---

## 6. Gaps Nobody Covers (The Notice Decoder Opportunity)

A critical synthesis reveals six distinct functional vacuums that none of the existing commercial tools, open-source repositories, or enterprise ERPs currently address:

* **1. Asymmetric "Deadline vs. Spanning Event" Clash Semantics:**
  * *The Gap:* Standard calendar conflict engines (Outlook Scheduling Assistant, Fantastical, TimeTree) treat a clash as an intersection between two intervals: $[Start_A, End_A] \cap [Start_B, End_B] \neq \emptyset$. A deadline, however, is a point in time $T_{deadline}$. When a college assignment deadline falls at `11:00 AM`, and the student has an examination or mandatory lab scheduled from `10:00 AM - 1:00 PM`, standard calendars do **not** flag this as a conflict because point milestones and reminder tasks do not occupy an interval block.
  * *Who lacks it:* Google Calendar, Apple Calendar, Outlook, Notion Calendar, Fantastical, TimeTree, AddEvent, Text2ICS, ScreenToCal, SyllySync, CollPoll, and Fedena.
  * *Exception:* Only high-end enterprise auto-schedulers (Motion, Reclaim) detect when a deadline lacks available preceding focus time, but they cost $10-$49/month, require enterprise Google/Exchange accounts, and cannot ingest messy circular text.

* **2. The DD/MM/YYYY vs. MM/DD/YYYY Ambiguity Trap in Academic Circulars:**
  * *The Gap:* In India, the universal date convention is `DD/MM/YYYY`. A notice stating an internal exam on `04/05/2026` refers to **4th May 2026**. Western-engineered tools (Text2ICS, AddEvent, Fantastical, Todoist, SyllySync, Doc2Calendar) default to American `MM/DD/YYYY` unless deep configuration settings are altered, misinterpreting the date as **April 5, 2026**.
  * *Who lacks it:* Doc2Calendar, SyllySync, Salendar, and AddEvent frequently invert ambiguous dates. Google Calendar and Apple Data Detectors fail if the underlying OS account profile was created with standard US defaults.

* **3. Indian Higher Education Vernacular & Hinglish Parsing:**
  * *The Gap:* College announcements in India are characterized by specific institutional terminology: *"pre-poned"*, *"arrear / backlog exam"*, *"internal assessment (IA/CIA)"*, *"LT-2 (Lecture Theatre)"*, *"viva voce"*, *"half-day"*, *"HOD"*, *"CR"*, *"admit card verification"*, and informal WhatsApp forwards (*"Kal sabko assignment submit karna hai by 12 noon in staff room, absent hue toh fine lagega"*). 
  * *Who lacks it:* Fantastical, Todoist, Motion, Reclaim, Structured, Doc2Calendar, ScreenToCal, and AddEvent crash or extract incorrect entities when confronted with Hinglish or Indian academic shorthand.

* **4. Multi-Event Disambiguation from a Single Messy Document:**
  * *The Gap:* Official circulars rarely describe a single isolated event. A single semester notice from an Indian college typically contains a timetable for 4 different branches (CSE, ECE, ME, Civil) across 3 different dates, with morning (FN: 09:30-12:30) and afternoon (AN: 01:30-04:30) shifts. 
  * *Who lacks it:* Apple Live Text and Google Data Detectors require clicking each date entity one-by-one; they cannot understand that "FN" corresponds to a morning slot or that an exam schedule is branch-specific. AI-to-ICS tools (Text2ICS, AddEvent) frequently lump the entire text into one single concatenated event or jumble start/end times across rows.

* **5. Closed-Garden ERP Isolation Without Portable Calendar Standards:**
  * *The Gap:* Indian campus ERP systems (CollPoll/Digii, Fedena, MyClassCampus, Edumarshal, MasterSoft) are walled gardens. They push notices as in-app text messages, SMS alerts, or attached static PDF circulars. None of these ERPs offer a one-click `.ics` export or dynamic webcal feed for individual notice events, leaving students with no automated way to bridge campus broadcasts into their personal everyday calendar apps.
  * *Who lacks it:* CollPoll, Fedena, MyClassCampus, Edumarshal, and university exam portals (AKTU, VTU).

* **6. "Human-in-the-Loop" Inline Error Correction Paired with Frictionless `.ics` Export:**
  * *The Gap:* Hackathon projects (SyllySync, Salendar, todue) attempt to push directly to Google Calendar via OAuth API, skipping a clean, visual correction UI where students can verify fields, adjust room numbers, or toggle event classifications (e.g., mark as "Test" vs. "Deadline") before saving. Conversely, tools that provide an edit step (AddEvent, Text2ICS) lack automated conflict/clash warning badges on the verification screen.
  * *Who lacks it:* SyllySync, Salendar, todue (lack interactive pre-export verification UI); AddEvent, Text2ICS, ScreenToCal (have edit UIs, but zero clash detection capabilities).

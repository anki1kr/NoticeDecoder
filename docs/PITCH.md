# Notice Decoder: demo script and judge questions

For the team presenting at SETU 2026. Every number here comes from `research/` or from running the app.

## 2-minute demo (zero-touch version, 2026-10-15)

0. **Open on the problem, not the app.** "A notice lands in the class group." Send the PDF sample into the demo group from the second phone. On the first phone (companion app installed, group ticked) a notification appears within seconds: *Added 3 events to your calendar*. Open the calendar: Internal Test 2, the deadline block, the guest lecture. **No paste, no form, no download.** Then: "and because the rules were sure of every field, it did not ask. When they are not sure..."
1. Send the timetable notice. Notification: *1 event needs a check*. Tap: the web app opens on that one event, "the notice says Thursday but 13 Nov 2026 is a Friday". Looks right -> Add all. "That is PS-02's review rule, shrunk to the one field that deserved it."
2. **Class representative:** on the laptop, paste the same notice, press **Publish to class**. Open the subscribe page on the second phone, Add to Google Calendar. "Publish once, the whole class is subscribed; a revised notice moves the event for everyone. This is the department plan."
3. **Email:** show the Apps Script run log (or the email *Check 1 event*) for a notice that came by mail.
4. Then, if time, the original walk-through below (highlights, why, clash timeline).

If the phone demo fails (battery saver, no notification): share the message from WhatsApp to Notice Decoder (installed PWA) with *Add automatically* on: same result, two taps.

## 2-minute demo (web walk-through)

1. **The problem (15 s).** "A notice lands in the class WhatsApp group. The date, time and room are buried in a paragraph. APSIT Mumbai stopped posting notices in WhatsApp groups in Sep 2025 because, in their words, many students miss important notices."
2. **Paste the PDF example, press Decode (20 s).** The top line says *3 events found. 2 clashes.* Point at the notice: each event's words are highlighted in its own colour, and the card wears the same colour.
3. **Ask "why?" (20 s).** Under Start on the deadline card: *"by 12:00 noon" = must happen by 12:00 PM*. Tap **Show in notice** and the words light up. "Every field says which words it came from and which rule read them."
4. **Clashes (25 s).** Timeline: test and lecture overlap 11:00 to 11:30, the 12:00 deadline falls inside the lecture. Read the suggestion: *Finish Lab record submission before 10:00 AM*. "It works back from the deadline past every event you are in, and names the last free moment."
5. **Fix one field (15 s).** Change the lecture start to 11:30. The overlap disappears at once.
6. **A messy real notice (20 s).** Tap **Placement drive**. The notice says results come "today by 9pm" and also "next day": both are shown in amber and export stays locked until you pick one. The notice is 8 days old, and the group discussion has no date, so it sits in **Not scheduled yet** instead of getting a made-up date.
7. **Add it (5 s).** **Add to Google Calendar** on one card, or **Download calendar file** for all.
8. **Timetable + the Thursday that is a Friday (20 s).** Tap **Exam timetable**. Five cards from a five-line timetable, each exam named by its subject; the viva at 11 clashes with the OS exam; the first row says "Thursday, 13 Nov 2026" and the app says *13 Nov 2026 is a Friday, check which one is right*. "A date library cannot see that. A student reading fast misses it."
9. **Share with the class (15 s).** Press **Share with class**: the link carries the events, no server. Open it on the second phone: same cards, same clash, one tap to add. "This is the free version of the department plan." If the phone is installed as an app, show WhatsApp -> Share -> Notice Decoder instead of pasting.

If the Wi-Fi drops, keep going: everything runs in the browser.

## Questions judges are likely to ask

**Why this problem?**
Notices arrive as long paragraphs, often forwarded late, and students act on them in a hurry. APSIT Mumbai moved notices out of WhatsApp groups in Sep 2025 because many students missed them. Jamia Millia Islamia (Sep 2026) now allows academic notices only in official class groups run by the class representative. Clashes make the news too: St Agnes College, Mangaluru set semester exams during the Dasara holidays (Oct 2026) and students protested.

**Who is it for?**
Students first. Second, the class representative, who today forwards every notice by hand and is the daily user of the paid plan (see Money).

**How is this different from other tools?**
We read the code of seven public notice projects from Oct 2026 (`research/06-public-competitors.md`). Most send the notice to Gemini, Gemma or another model and return a summary or a deadline list. None of them exports a calendar file or checks for clashes, and those two are what PS-02 asks for. Two related projects do part of it for other inputs: notice-hub (Chinese QQ groups) gives a calendar subscription without clash checks, and edt-tamis checks university timetable files for exam clashes and exports iCalendar. Neither reads a pasted college notice.

**Why rules and not AI?**
- The answer is the same every time, so the student can trust it and we can test it (19 engine tests, plus 20 messy notices written by an outside reviewer: 145 of 152 field checks right).
- Each field shows its reason and its source words, so a wrong result can be seen and fixed.
- It runs in the browser: no data leaves the phone, no API key, no cost per notice, and the demo works offline.
- We have not run an AI model on the same notices, so we do not claim AI would score lower. One study of models answering questions about event dates (TRAVELER, 2025) found accuracy drops when the date is vague, which is exactly where we flag instead of guessing.

**So the student still has to paste?**
Not any more. On Android the companion app reads the class group from the notification shade and writes the calendar itself; by email the Gmail script does; on any phone *Share -> Notice Decoder* with auto-add on does. The paste box is the fallback. The student is asked only when a field is uncertain, which PS-02 requires.

**Isn't that a lot of manual work in 2026?**
The problem statement requires the student to review every field before export. We kept the review and made it short: fields the rules are sure of say "Nothing to check", and only uncertain fields are outlined in amber with the question ("read as 4 May; if it means 5 April, fix the date"). Export stays locked until each amber field is fixed or the card is marked "Looks right". After that, adding to the calendar is one tap.

**Why read 04/05 as 4 May?**
Indian notices write the day first. When both readings are real dates, the app says which one it chose and asks.

**Why is a deadline a point and not a block?**
The problem statement says so, and it matches reality: "submit by 12:00" has no start. It clashes when it falls inside another event. In the calendar it shows as the 30 minutes before the deadline, so the reminder lands in time.

**What about a revised or cancelled notice?**
"Postponed to 20 Nov" or a later "rescheduled to 12 Nov" moves the event and shows what it was before. A sentence that cancels something is reported and never added. Two different dates for the same thing are both shown in amber until the student picks one.

**What happens with a notice it cannot read?**
No date found: the card says so and export stays locked. A time without AM/PM: it assumes college hours (2:30 means 2:30 PM) and flags the guess. "kal" (yesterday or tomorrow) and "next Monday" are read and flagged. Phrases like "this week or next week" go to **Not scheduled yet**. A test you can take any time in a window (1:30 to 5 PM, 60 minutes) only clashes if no free hour is left, and the app says when to take it.

**What does it not do yet?**
Read photos of notices, fix spelling mistakes ("tset", "Nvo" leave the date empty and lock export), or update a calendar automatically when a revised notice comes out (that is the paid plan). Hindi: dates, times, the common event words and room words are read (example 06); long Hindi prose titles are still rough. The .ics gives each event a stable ID so a later import can update it; we have not tested that on every calendar app.

**How did you test it?**
`node tests/engine.test.mjs` (27 tests), a Playwright run of the full page at phone width (42 checks: decode, edit, delete/undo, copy, share-link round trip, share target, service worker, offline), the .ics files read back with Python's `icalendar` parser, and three reviewer agents acting as judges who wrote their own messy notices. Test notices and expected answers are in `examples/` (six). The 2026-10-15 review found the same-type merge bug (two exams at 10 AM became one card and "No clashes"), one-sentence-two-events, timetables, fractions read as dates and ISO dates; each is now a test.

## Money

**Who uses it, who pays, why.**

| Plan | Who uses it | Who pays | What they get | Our cost |
|---|---|---|---|---|
| Free | every student | nobody | paste, check, clashes, calendar file, Google Calendar button | about zero: it runs on the phone |
| Department plan (hosted; the link version is built and free) | the CR or a teacher | the department, signed off by the HOD from the department budget | decode a notice once and publish it; the class subscribes to one calendar link that updates itself, with clash checks across all notices of the term | a small server and storage for the published calendars |

**Price.** Our proposed price is **₹2,999 per department per year**, free for the first term of a pilot. This is our estimate, to be tested in the pilot. For scale: Fedena, a full college ERP, lists $999 to $1,699 a year for the whole college (`research/04`), so one feature for one department has to cost far less.

**Why pay when WhatsApp and a shared Google Calendar are free?** The free "Share with class" link already does the typing once for everyone (show it). What it cannot do is change after it is sent: a revised notice means a new link, and nobody's calendar moves. The CR can already forward a notice or type each event into a shared calendar by hand. The paid plan does the typing, catches clashes before they are published, keeps one link that never has to be forwarded again, and moves an event for everyone when a notice is revised.

**Pilot.** One department, one term. We measure notices published, events added, and how many clashes were caught before the date. It succeeds if the HOD agrees to pay for the next term.

**Honest status.** No college has paid yet. The only willingness-to-pay data we found is about exam-prep apps (Gray Matters, 2020), so we do not use it to justify this price. The paid plan needs a server, so a published calendar does leave the device; the free plan stays fully on the phone.

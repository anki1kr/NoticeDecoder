Source: written for this repo. Each line is a shape that silently went wrong before 2026-10-15.

| Event | Type | Date | Time | Venue |
|---|---|---|---|---|
| Internal test: Maths | Test | 13 Nov 2026 | 10:00 AM (1 h default) | Room 1 |
| Guest lecture: Cloud Basics | Lecture | 13 Nov 2026 | 11:00 AM | Seminar Hall |
| Lab exam: Physics | Exam | 13 Nov 2026 | 10:00 AM - 12:00 PM, report 9:30 AM | Lab 2 |
| Assignment 2 upload | Deadline | 13 Nov 2026 | by 5:00 PM (EOD, flagged) | portal |

Must detect:
- Two tests at the same hour are TWO events and a clash (they used to merge into one card, hiding the clash).
- One sentence with "and" holds two events when both halves have a time and an event word.
- "Reporting 0930 hrs" is the reporting time of the exam above it, not a third event; "0930 hrs" is 24-hour time.
- "2026-11-13" (ISO) is read; "EOD" = 5 PM with an amber flag.
- The 5 PM deadline is after every event, so no clash with it.

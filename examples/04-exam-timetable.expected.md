Source: written for this repo from the shape of real department timetables (date - subject - time - room rows under a header).

| Event | Type | Date | Time | Venue |
|---|---|---|---|---|
| DBMS exam | Exam | 13 Nov 2026 | 10:00 AM - 1:00 PM | Room 101 |
| Operating Systems exam | Exam | 14 Nov 2026 | 10:00 AM - 1:00 PM | Room 101 |
| Computer Networks exam | Exam | 16 Nov 2026 | 2:00 PM - 5:00 PM | Room 102 |
| Practical viva: DBMS | Viva | 14 Nov 2026 | 11:00 AM | Lab 2 |
| Hall tickets collection | Deadline | 12 Nov 2026 | by 4:00 PM | Office |

Must detect:
- Rows are three different exams, named by the subject cell, with the kind from the header ("Exam schedule"). NOT three events called "Event" and NOT a "two dates for the same thing" warning.
- "Thursday, 13 Nov 2026": 13 Nov 2026 is a Friday -> amber flag asking which is right.
- Viva (14 Nov, 11 AM, 1 h default) clashes with the OS exam (10-1): it is a different exam, not a second mention of it.
- "75/100" is attendance, not 75 October.
- Hall ticket collection is a deadline (point) on 12 Nov, 4 PM.

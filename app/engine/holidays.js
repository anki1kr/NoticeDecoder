// Gazetted holidays (Government of India list) for the academic years the app will see.
// Used only to ASK: an event on one of these days gets an amber "confirm the college is open" flag,
// it is never moved or dropped. Colleges add state and restricted holidays of their own, so edit this
// list from the college's academic calendar. Lunar dates can shift by a day; those are marked "approx".
export const HOLIDAYS = {
  '2026-01-26': 'Republic Day',
  '2026-03-04': 'Holi',
  '2026-03-20': 'Eid ul-Fitr (approx.)',
  '2026-03-31': 'Mahavir Jayanti',
  '2026-04-03': 'Good Friday',
  '2026-05-01': 'Buddha Purnima',
  '2026-05-27': 'Eid ul-Adha (approx.)',
  '2026-08-15': 'Independence Day',
  '2026-09-04': 'Janmashtami',
  '2026-09-14': 'Ganesh Chaturthi',
  '2026-10-02': 'Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-08': 'Diwali',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',
  '2027-01-26': 'Republic Day',
  '2027-03-22': 'Holi',
  '2027-08-15': 'Independence Day',
  '2027-10-02': 'Gandhi Jayanti',
  '2027-10-09': 'Dussehra',
  '2027-10-29': 'Diwali',
  '2027-12-25': 'Christmas',
};

export const holidayOn = (isoDate) => HOLIDAYS[isoDate] || null;

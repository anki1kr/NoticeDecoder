// Deployment settings. Everything here is public by design (it ships in the page).
//
// GOOGLE_CLIENT_ID powers "Add all to Google Calendar" (one tap, no .ics). Create it once:
//   Google Cloud console -> APIs & Services -> Credentials -> Create credentials -> OAuth client ID
//   -> Web application; Authorised JavaScript origins: https://anki1kr.me and http://127.0.0.1:8771
//   (no redirect URIs: the page uses the Google Identity Services token flow).
//   Enable "Google Calendar API" for the project. On the OAuth consent screen, Testing mode is enough
//   for the hackathon: add the team's and judges' Google accounts as test users (limit 100).
// Leave it empty and the button explains what is missing instead of failing.
export const GOOGLE_CLIENT_ID = '';

// Class feed (Phase 2): the Worker that serves webcal feeds. Empty = feature hidden.
export const FEED_BASE = '';

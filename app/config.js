// Deployment settings. Everything here is public by design (it ships in the page).
//
// GOOGLE_CLIENT_ID powers "Add all to Google Calendar" (one tap, no .ics). Create it once:
//   Google Cloud console -> APIs & Services -> Credentials -> Create credentials -> OAuth client ID
//   -> Web application; Authorised JavaScript origins: https://anki1kr.me and http://127.0.0.1:8771
//   (no redirect URIs: the page uses the Google Identity Services token flow).
//   Enable "Google Calendar API" for the project. The scope is calendar.app.created (non-sensitive), so publish the
//   OAuth consent screen "In production": no test-user list and no unverified-app screen.
// Leave it empty and the button explains what is missing instead of failing.
export const GOOGLE_CLIENT_ID = '1048623925742-fu9isnfo2ueuj3o77jgp9sej4ou2upub.apps.googleusercontent.com';

// Class feed (Phase 2): the Worker that serves webcal feeds. Empty = feature hidden.
export const FEED_BASE = 'https://notice-decoder-feed.ankit25679.workers.dev';

# Notice Decoder companion (Android)

The zero-touch path. A notice lands in a WhatsApp class group; the phone's notification shade shows it; this app
reads that notification (only for groups you tick), runs the same rules engine as the web app on the phone, and
writes the events into your calendar. You get a notification: *Added 3 events* (Undo), or *1 event needs a check*,
which opens the web app on that one event. Nothing is uploaded; the engine runs on the phone.

Expo SDK 57 (React Native 0.86). Free: Expo and EAS have free tiers; the notification-listener library is MIT.

## Run it

```bash
cd companion
npm install --legacy-peer-deps      # the listener library still declares react 18 as a peer; it runs fine on 19
npx expo install --fix              # pins every expo-* package to the SDK 57 versions
npm test                            # node tests of the pipeline (no phone needed)
npm run android                     # builds a dev client and installs it on a connected phone / emulator
```

A real phone is needed to see WhatsApp notifications (an emulator has no WhatsApp). APK for judges:
`npm run build:apk` (EAS, free tier, `eas login` first) or `npm run prebuild && cd android && ./gradlew assembleRelease`.

## First launch on the phone

1. Allow **Read notifications**: Android opens *Notification access*; switch Notice Decoder on. Then Calendar and
   Notifications permissions.
2. Under **Groups to watch**, tick your class group (its name appears after the next WhatsApp message) or type it.
3. Leave **Add certain events without asking** on. Send the PS-02 sample into the group from another phone: within
   seconds a notification says *Added 3 events*; the calendar app shows them in "Class notices".
4. Send a notice with "Thursday, 13 Nov 2026": the notification says *1 event needs a check*; tap it, the web app
   opens on that event, tap **Looks right** then **Add all to your phone calendar**.

## How it is built

| File | What |
|---|---|
| `index.js` | registers the headless task the listener wakes for every notification, then the app |
| `plugins/withNotificationListener.js` | config plugin: the two Android services the listener needs in the manifest |
| `engine/notice-engine.js` | generated copy of `dist/notice-engine.js` (`npm run sync-engine`); never edit here |
| `src/pipeline.js` | pure logic: notification -> texts, text -> plan (clean entries / amber events), share payload |
| `src/handler.js` | the one path every notice takes: calendar write, parked items, notifications, CR publish |
| `src/calendar.js` | expo-calendar: "Class notices" calendar, upsert by UID, reminders, undo |
| `src/notify.js` | local notifications with Undo / Check actions |
| `src/feed.js` | class feed: pull every 15 min (expo-background-task), CR push |
| `src/review.js` | the web app in a WebView on the parked events; its "Add all" posts back to the phone calendar |
| `App.js` | permissions, group picker, switches, pending list, test box, log |

## Known limits (say them in the demo)

- The listener sees what the notification shows. WhatsApp puts the full message in `bigText` for a single message;
  when several arrive at once it shows the last few lines per message. A very long notice may be cut; the share sheet
  (WhatsApp -> Share -> Notice Decoder) is the fallback and always carries the whole text.
- Android may stop background work on aggressive battery savers (some Xiaomi/Oppo builds); exclude the app from
  battery optimisation if notifications arrive but nothing is added.
- `react-native-android-notification-listener` is a legacy native module; it runs through React Native's interop
  layer on the new architecture. If a future RN drops that layer, the listener needs a small Expo module of its own.
- iPhone cannot read other apps' notifications at all; iOS users use the web app's share sheet.

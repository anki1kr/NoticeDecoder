// Expo config plugin: declares the two Android services react-native-android-notification-listener needs
// (the NotificationListenerService that receives WhatsApp notifications, and the headless JS service that runs
// our handler) so `expo prebuild` / EAS writes them into AndroidManifest.xml. Without this the listener is silent.
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const LISTENER = 'com.lesimoes.androidnotificationlistener.RNAndroidNotificationListener';
const HEADLESS = 'com.lesimoes.androidnotificationlistener.RNAndroidNotificationListenerHeadlessJsService';

module.exports = function withNotificationListener(config) {
  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app.service = (app.service || []).filter((s) => ![LISTENER, HEADLESS].includes(s.$['android:name']));
    app.service.push({
      $: {
        'android:name': LISTENER,
        'android:label': '@string/app_name',
        'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        'android:exported': 'true',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.notification.NotificationListenerService' } }] }],
    });
    app.service.push({ $: { 'android:name': HEADLESS, 'android:exported': 'false' } });
    return mod;
  });
};

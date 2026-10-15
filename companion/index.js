// Entry. Registers the headless task that react-native-android-notification-listener wakes for every posted
// notification (app in background or killed), then the React app.
import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import { RNAndroidNotificationListenerHeadlessJsName } from 'react-native-android-notification-listener';
import './engine/notice-engine.js';
import { handleNotification } from './src/handler.js';
import App from './App';

AppRegistry.registerHeadlessTask(RNAndroidNotificationListenerHeadlessJsName, () => async ({ notification }) => {
  await handleNotification(notification);
});

registerRootComponent(App);

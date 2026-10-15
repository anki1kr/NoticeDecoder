// Local notifications: "Added 3 events" (with Undo) and "Check 1 field" (opens the review screen).
import * as Notifications from 'expo-notifications';

const CHANNEL = 'notices';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function ensurePermission() {
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Class notices', importance: Notifications.AndroidImportance.DEFAULT, sound: null });
  await Notifications.setNotificationCategoryAsync('added', [{ identifier: 'undo', buttonTitle: 'Undo', options: { opensAppToForeground: false } }]);
  await Notifications.setNotificationCategoryAsync('check', [{ identifier: 'review', buttonTitle: 'Check now', options: { opensAppToForeground: true } }]);
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export function notifyAdded(entries, extra = {}) {
  const n = entries.length;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `Added ${n} event${n === 1 ? '' : 's'} to your calendar`,
      body: entries.map((e) => e.summary).join(' · ').slice(0, 200),
      categoryIdentifier: 'added',
      data: { kind: 'added', uids: entries.map((e) => e.uid), ...extra },
    },
    trigger: null,
  });
}

export function notifyCheck(pendingId, amber, group) {
  const n = amber.length;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `${n} event${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a check`,
      body: `${group ? `${group}: ` : ''}${amber.map((e) => e.title).join(', ')}. Not added yet; tap to check.`,
      categoryIdentifier: 'check',
      data: { kind: 'check', pendingId },
    },
    trigger: null,
  });
}

export function notifyClash(clashes) {
  return Notifications.scheduleNotificationAsync({
    content: { title: `${clashes.length} clash${clashes.length === 1 ? '' : 'es'} in this notice`, body: clashes.map((c) => c.msg).join(' ').slice(0, 220), data: { kind: 'clash' } },
    trigger: null,
  });
}

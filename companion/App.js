// One screen: permissions, which WhatsApp groups to watch, auto-add switch, class id, what happened, and a test
// button. Plus the review screen (web app in a WebView) for parked notices.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, TextInput, StyleSheet, AppState, Alert, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import './engine/notice-engine.js';
import { getSettings, setSettings, seenTitles, getLog, getPending, removePending } from './src/store.js';
import { ensurePermission as calendarPermission, listCalendars } from './src/calendar.js';
import { ensurePermission as notifyPermission } from './src/notify.js';
import { handleNotice } from './src/handler.js';
import { feedConfigured, pullClass, scheduleFeedPolling } from './src/feed.js';
import { removeByUids } from './src/calendar.js';
import { oneLine } from './src/pipeline.js';
import Review from './src/review.js';

const SAMPLE = 'All III-year CSE students: Internal Test 2 will be held on 13 Nov 2026 from 10:00 AM to 11:30 AM in Room 204. Lab records must be submitted to the department office by 12:00 noon on 13 Nov. A guest lecture on "AI in Healthcare" is scheduled on 13 Nov, 11:00 AM to 12:30 PM, Seminar Hall.';

export default function App() {
  const [settings, setS] = useState(null);
  const [listener, setListener] = useState('unknown');
  const [perms, setPerms] = useState({ calendar: false, notify: false });
  const [titles, setTitles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [pending, setPending] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [review, setReview] = useState(null);
  const [newGroup, setNewGroup] = useState('');
  const [testText, setTestText] = useState(SAMPLE);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    setS(await getSettings());
    setTitles(await seenTitles());
    setLogs(await getLog());
    setPending(await getPending());
    if (Platform.OS === 'android') setListener(await RNAndroidNotificationListener.getPermissionStatus());
  }, []);

  useEffect(() => {
    (async () => {
      const calendar = await calendarPermission();
      const notify = await notifyPermission();
      setPerms({ calendar, notify });
      if (calendar) setCalendars(await listCalendars());
      await scheduleFeedPolling();
      await refresh();
    })();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refresh(); });
    const resp = Notifications.addNotificationResponseReceivedListener(async (r) => {
      const data = r.notification.request.content.data || {};
      if (data.kind === 'added' && r.actionIdentifier === 'undo') { const n = await removeByUids(data.uids || []); setMsg(`Undo: removed ${n}.`); refresh(); }
      if (data.kind === 'check') { const item = (await getPending()).find((p) => p.id === data.pendingId); if (item) setReview(item); }
    });
    return () => { sub.remove(); resp.remove(); };
  }, [refresh]);

  if (!settings) return <View style={s.center}><Text>Loading...</Text></View>;
  if (review) return <Review item={review} onDone={() => { setReview(null); refresh(); }} />;

  const groups = settings.groups;
  const toggleGroup = async (g) => { const next = groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]; setS(await setSettings({ groups: next })); };
  const addGroup = async () => { const g = newGroup.trim(); if (!g) return; setNewGroup(''); if (!groups.includes(g)) setS(await setSettings({ groups: [...groups, g] })); };

  const runTest = async () => {
    try { const r = await handleNotice(testText, { group: 'Test', force: false }); setMsg(`Found ${r.events} event(s): added ${r.added}, updated ${r.updated}, to check ${r.amber}, clashes ${r.clashes}.`); }
    catch (err) { setMsg(String(err.message || err)); }
    refresh();
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={{ padding: 16, paddingTop: 48, paddingBottom: 40 }}>
      <StatusBar style="dark" />
      <Text style={s.h1}>Notice Decoder</Text>
      <Text style={s.lede}>Notices from your class groups go into your calendar by themselves. You are asked only when a field is uncertain.</Text>

      <View style={s.card}>
        <Text style={s.h2}>1. Permissions</Text>
        <Row label="Read notifications (WhatsApp)" ok={listener === 'authorized'} action={listener === 'authorized' ? null : () => RNAndroidNotificationListener.requestPermission()} actionText="Allow" />
        <Row label="Calendar" ok={perms.calendar} action={perms.calendar ? null : async () => setPerms({ ...perms, calendar: await calendarPermission() })} actionText="Allow" />
        <Row label="Notifications" ok={perms.notify} action={perms.notify ? null : async () => setPerms({ ...perms, notify: await notifyPermission() })} actionText="Allow" />
        <Text style={s.hint}>Only notifications from WhatsApp groups you tick below are read. Nothing is uploaded anywhere; the rules run on this phone.</Text>
      </View>

      <View style={s.card}>
        <Text style={s.h2}>2. Groups to watch</Text>
        {titles.length === 0 && groups.length === 0 ? <Text style={s.hint}>No WhatsApp chats seen yet. When the next message arrives its chat name appears here; or type the exact group name.</Text> : null}
        {[...new Set([...groups, ...titles])].map((g) => (
          <Pressable key={g} onPress={() => toggleGroup(g)} style={s.rowBtn}>
            <Text style={s.check}>{groups.includes(g) ? '☑' : '☐'}</Text><Text style={s.rowText}>{g}</Text>
          </Pressable>
        ))}
        <View style={s.inline}>
          <TextInput value={newGroup} onChangeText={setNewGroup} placeholder="Group name, exactly as in WhatsApp" style={s.input} onSubmitEditing={addGroup} />
          <Btn onPress={addGroup} text="Add" />
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.h2}>3. How to add</Text>
        <View style={s.rowBetween}>
          <Text style={s.rowText}>Add certain events without asking (Undo in the notification)</Text>
          <Switch value={settings.autoAdd} onValueChange={async (v) => setS(await setSettings({ autoAdd: v }))} />
        </View>
        <Text style={s.hint}>Off: every notice waits for one tap. Either way, an uncertain field is always asked.</Text>
        {calendars.length > 1 ? (
          <View style={{ marginTop: 10 }}>
            <Text style={s.label}>Calendar</Text>
            {calendars.map((c) => (
              <Pressable key={c.id} onPress={async () => setS(await setSettings({ calendarId: c.id }))} style={s.rowBtn}>
                <Text style={s.check}>{settings.calendarId === c.id ? '◉' : '○'}</Text><Text style={s.rowText}>{c.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {feedConfigured() ? (
        <View style={s.card}>
          <Text style={s.h2}>4. Class calendar</Text>
          <Text style={s.hint}>Paste the class id from the class representative. New or revised events published for the class land here every 15 minutes.</Text>
          <TextInput value={settings.classId} onChangeText={async (v) => setS(await setSettings({ classId: v.trim() }))} placeholder="class id, e.g. abcd2345" style={s.input} autoCapitalize="none" />
          <TextInput value={settings.classSecret} onChangeText={async (v) => setS(await setSettings({ classSecret: v.trim() }))} placeholder="class secret (class representatives only)" style={s.input} autoCapitalize="none" secureTextEntry />
          <Btn onPress={async () => { try { const r = await pullClass(); setMsg(r.skipped ? 'Set a class id first.' : `${r.name}: ${r.added} new, ${r.updated} updated, ${r.removed} removed.`); } catch (e) { setMsg(String(e.message)); } refresh(); }} text="Pull now" />
        </View>
      ) : null}

      {pending.length ? (
        <View style={s.card}>
          <Text style={s.h2}>Waiting for your check</Text>
          {pending.map((p) => (
            <View key={p.id} style={{ marginBottom: 10 }}>
              <Text style={s.rowText}>{p.group ? `${p.group}: ` : ''}{p.amber.map(oneLine).join('; ')}</Text>
              <View style={s.inline}><Btn onPress={() => setReview(p)} text="Check and add" primary /><Btn onPress={async () => { await removePending(p.id); refresh(); }} text="Dismiss" /></View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.h2}>Test it</Text>
        <TextInput value={testText} onChangeText={setTestText} multiline style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} />
        <Btn onPress={runTest} text="Run this text through the decoder" primary />
        {msg ? <Text style={s.msg}>{msg}</Text> : null}
      </View>

      <View style={s.card}>
        <Text style={s.h2}>Recent</Text>
        {logs.length === 0 ? <Text style={s.hint}>Nothing yet.</Text> : logs.slice(0, 12).map((l, i) => (
          <Text key={i} style={s.log}><Text style={{ fontWeight: '700' }}>{l.kind}</Text> {new Date(l.at).toLocaleString()} · {l.text}</Text>
        ))}
      </View>
      <Text style={s.foot}>Clear rules find dates, times, places and clashes. Every result can be checked in the web app.</Text>
    </ScrollView>
  );
}

function Row({ label, ok, action, actionText }) {
  return (
    <View style={s.rowBetween}>
      <Text style={s.rowText}>{ok ? '✓ ' : '· '}{label}</Text>
      {action ? <Btn onPress={action} text={actionText} /> : <Text style={s.ok}>OK</Text>}
    </View>
  );
}

function Btn({ onPress, text, primary }) {
  return <Pressable onPress={onPress} style={[s.btn, primary && s.btnPrimary]}><Text style={[s.btnText, primary && { color: '#fff' }]}>{text}</Text></Pressable>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#efeef2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 28, fontWeight: '800', color: '#1d1b26' },
  lede: { fontSize: 16, color: '#1d1b26', marginTop: 4, marginBottom: 8 },
  h2: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: '#1d1b26' },
  card: { backgroundColor: '#fdfdfc', borderWidth: 1, borderColor: '#d9d7e1', borderRadius: 8, padding: 14, marginTop: 14 },
  hint: { color: '#55526a', fontSize: 14, marginTop: 6 },
  label: { fontWeight: '600', marginBottom: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44 },
  rowBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  rowText: { flex: 1, fontSize: 16, color: '#1d1b26' },
  check: { fontSize: 20, color: '#3d2c8d' },
  ok: { color: '#15803d', fontWeight: '700' },
  inline: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#8f8aa6', borderRadius: 6, padding: 10, fontSize: 16, backgroundColor: '#fff', marginTop: 8, minHeight: 44 },
  btn: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: '#8f8aa6', backgroundColor: '#fff', marginTop: 8 },
  btnPrimary: { backgroundColor: '#3d2c8d', borderColor: '#3d2c8d' },
  btnText: { fontWeight: '700', color: '#1d1b26' },
  msg: { marginTop: 10, fontWeight: '600', color: '#3d2c8d' },
  log: { fontSize: 13, color: '#55526a', marginBottom: 4 },
  foot: { color: '#55526a', fontSize: 13, marginTop: 16 },
});

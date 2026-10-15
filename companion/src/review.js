// Review screen: the web app itself, in a WebView, opened on the parked (amber) events through the same #s= link the
// web app shares. The student fixes or confirms there; "Add all" in the page posts the events back and they go into
// the phone calendar. One UI for both, no second form to maintain.
import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { sharePayload } from './pipeline.js';
import { upsertAll } from './calendar.js';
import { removePending, log } from './store.js';
import { notifyAdded } from './notify.js';

const APP_URL = String(Constants.expoConfig?.extra?.appUrl || 'https://anki1kr.me/NoticeDecoder/app/');
const E = () => globalThis.NoticeEngine;

export default function Review({ item, onDone }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const url = `${APP_URL}#s=${sharePayload(item.amber)}`;

  async function onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type !== 'nd-add' || !Array.isArray(msg.events)) return;
    setBusy(true);
    try {
      const entries = E().calendarEntries(msg.events);
      const r = await upsertAll(entries);
      await notifyAdded(entries, { group: item.group });
      await removePending(item.id);
      await log('added', `${item.group || 'review'}: ${entries.map((x) => x.summary).join(', ')} (after check)`);
      setStatus(`Added ${r.added}, updated ${r.updated}.`);
      setTimeout(onDone, 600);
    } catch (err) {
      setStatus(String(err.message || err));
    } finally { setBusy(false); }
  }

  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Pressable onPress={onDone} style={s.back}><Text style={s.backText}>‹ Back</Text></Pressable>
        <Text style={s.title} numberOfLines={1}>{item.group || 'Check the notice'}</Text>
        {busy ? <ActivityIndicator color="#3d2c8d" /> : null}
      </View>
      {status ? <Text style={s.status}>{status}</Text> : null}
      <WebView ref={ref} source={{ uri: url }} onMessage={onMessage} style={{ flex: 1 }} startInLoadingState javaScriptEnabled domStorageEnabled />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#efeef2' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, paddingTop: 44, backgroundColor: '#fdfdfc', borderBottomWidth: 1, borderBottomColor: '#d9d7e1' },
  back: { padding: 6 },
  backText: { color: '#3d2c8d', fontWeight: '700', fontSize: 16 },
  title: { flex: 1, fontWeight: '700', fontSize: 16, color: '#1d1b26' },
  status: { padding: 10, color: '#15803d', fontWeight: '600' },
});

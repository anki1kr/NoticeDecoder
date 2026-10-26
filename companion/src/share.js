// "Share -> Notice Decoder" from WhatsApp, the gallery or a PDF viewer (expo-share-intent). The web app does the
// reading: a text share opens it on ?text=, a file share opens it and posts the bytes in as an nd-file message, so the
// same OCR / PDF code and the same review gate run here. "Add all" posts the events back to the phone calendar.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { upsertAll } from './calendar.js';
import { notifyAdded } from './notify.js';
import { log } from './store.js';

const APP_URL = String(Constants.expoConfig?.extra?.appUrl || 'https://noticedecoder.pages.dev/app/');
const E = () => globalThis.NoticeEngine;

export default function Share({ intent, onDone }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const file = intent?.files?.[0];
  const text = intent?.text || intent?.webUrl || '';
  const url = file ? APP_URL : `${APP_URL}?text=${encodeURIComponent(text)}`;

  async function pushFile() {
    if (!file || !ref.current) return;
    try {
      const data = await FileSystem.readAsStringAsync(file.path, { encoding: 'base64' });
      const msg = JSON.stringify({ type: 'nd-file', name: file.fileName || 'shared', mime: file.mimeType || 'application/octet-stream', data });
      ref.current.injectJavaScript(`document.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(msg)} })); true;`);
    } catch (err) { setStatus(String(err.message || err)); }
  }

  async function onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type !== 'nd-add' || !Array.isArray(msg.events)) return;
    setBusy(true);
    try {
      const entries = E().calendarEntries(msg.events);
      const r = await upsertAll(entries);
      await notifyAdded(entries, { group: 'shared' });
      await log('added', `shared: ${entries.map((x) => x.summary).join(', ')}`);
      setStatus(`Added ${r.added}, updated ${r.updated}.`);
      setTimeout(onDone, 600);
    } catch (err) { setStatus(String(err.message || err)); } finally { setBusy(false); }
  }

  useEffect(() => { setStatus(file ? `Opening ${file.fileName || 'the file'}…` : ''); }, [file]);

  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Pressable onPress={onDone} style={s.back}><Text style={s.backText}>‹ Back</Text></Pressable>
        <Text style={s.title} numberOfLines={1}>Shared notice</Text>
        {busy ? <ActivityIndicator color="#3d2c8d" /> : null}
      </View>
      {status ? <Text style={s.status}>{status}</Text> : null}
      <WebView ref={ref} source={{ uri: url }} onMessage={onMessage} onLoadEnd={pushFile} style={{ flex: 1 }} startInLoadingState javaScriptEnabled domStorageEnabled />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#efeef2' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, paddingTop: 44, backgroundColor: '#fdfdfc', borderBottomWidth: 1, borderBottomColor: '#d9d7e1' },
  back: { padding: 6 },
  backText: { color: '#3d2c8d', fontWeight: '700', fontSize: 16 },
  title: { flex: 1, fontWeight: '700', fontSize: 16, color: '#1d1b26' },
  status: { padding: 10, color: '#3d2c8d', fontWeight: '600' },
});

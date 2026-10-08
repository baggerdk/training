// Platform layer: native Capacitor plugins in the Android app, web APIs as fallback in the browser (GitHub Pages / serve.js).
// Plugins are reached through capacitorExports.registerPlugin(), so no bundler or plugin JS is needed – only vendor/capacitor.js,
// which scripts/build-web.js injects into the native build.
'use strict';

const PLATFORM = (() => {
  const core = window.capacitorExports;
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plug = name => native && core ? core.registerPlugin(name) : null;
  const Haptics = plug('Haptics'), KeepAwake = plug('KeepAwake'), Notif = plug('LocalNotifications');
  const Filesystem = plug('Filesystem'), Share = plug('Share'), Browser = plug('Browser');

  const REST_NOTIF_ID = 1001;
  let wakeLock = null, channelReady = null;

  // Vibration pattern like navigator.vibrate: number or [on, off, on, ...] in ms
  function vibrate(p) {
    if (!Haptics) { if (navigator.vibrate) navigator.vibrate(p); return; }
    const parts = Array.isArray(p) ? p : [p];
    let at = 0;
    parts.forEach((ms, i) => {
      if (i % 2 === 0 && ms > 0) setTimeout(() => Haptics.vibrate({ duration: ms }).catch(() => { }), at);
      at += ms;
    });
  }

  async function keepAwake(on) {
    try {
      if (KeepAwake) { await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()); return; }
      if (on) { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
      else { wakeLock && wakeLock.release(); wakeLock = null; }
    } catch (e) { }
  }

  // Notification channel with high importance, so the rest alarm sounds and vibrates when the screen is off
  function ensureChannel() {
    if (!Notif) return Promise.resolve(false);
    if (!channelReady) channelReady = (async () => {
      try {
        let p = await Notif.checkPermissions();
        if (p.display !== 'granted') p = await Notif.requestPermissions();
        if (p.display !== 'granted') return false;
        await Notif.createChannel({ id: 'rest', name: 'Pausetimer', description: 'Signal når pausen er slut', importance: 5, visibility: 1, vibration: true });
        return true;
      } catch (e) { return false; }
    })();
    return channelReady;
  }

  // Schedules a system notification at endMs (epoch ms). Used while the app is in the background.
  async function scheduleRestAlarm(endMs, title, body) {
    if (!(await ensureChannel())) return;
    try {
      await Notif.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
      await Notif.schedule({ notifications: [{ id: REST_NOTIF_ID, title, body, channelId: 'rest', schedule: { at: new Date(endMs), allowWhileIdle: true } }] });
    } catch (e) { }
  }
  async function cancelRestAlarm() {
    if (!Notif) return;
    try { await Notif.cancel({ notifications: [{ id: REST_NOTIF_ID }] }); } catch (e) { }
  }

  // Saves a text file: share sheet in the app, download in the browser
  async function saveTextFile(name, text, mime) {
    if (Filesystem && Share) {
      const r = await Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: name, files: [r.uri] });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function openExternal(url) {
    if (Browser) Browser.open({ url }).catch(() => { });
    else window.open(url, '_blank', 'noopener');
  }

  return { native, vibrate, keepAwake, ensureChannel, scheduleRestAlarm, cancelRestAlarm, saveTextFile, openExternal };
})();

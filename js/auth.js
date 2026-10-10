// Login and session against the power-krop API.
// Offline-first: a logged-in user stays logged in without network. The profile is cached in localStorage,
// the refresh token lives in secure storage (Android Keystore), and the access token only in memory.
'use strict';

const AUTH = (() => {
  const PROFILE_KEY = 'powerkrop-profile';
  const REFRESH_KEY = 'refresh';
  const ACCESS_TTL_MS = 14 * 60 * 1000;   // the server issues 15 min; renew a minute early

  // The old PWA on GitHub Pages keeps working without an account until its users have moved to the app
  const required = typeof API_BASE_URL === 'string' && location.hostname !== 'baggerdk.github.io';

  let profile = null, access = null, accessUntil = 0, refreshing = null;
  try { profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { profile = null; }
  const listeners = [];

  function setProfile(p) {
    profile = p;
    try { p ? localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) : localStorage.removeItem(PROFILE_KEY); } catch (e) { }
    listeners.forEach(fn => fn(p));
  }

  class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }

  // Raw call. Throws ApiError with a Danish message; status 0 = no connection.
  async function call(path, opts) {
    opts = opts || {};
    const headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    let res;
    try {
      res = await fetch(API_BASE_URL + path, {
        method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
        headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: 'no-store',
      });
    } catch (e) {
      throw new ApiError(0, 'offline', 'Ingen forbindelse til serveren – prøv igen, når du er online');
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const msg = res.status === 429 ? 'For mange forsøg – vent lidt, og prøv igen'
        : (data && data.message) || 'Serveren svarede med en fejl (' + res.status + ')';
      throw new ApiError(res.status, (data && data.error) || 'http_' + res.status, msg);
    }
    return data;
  }

  async function startSession(r) {
    await PLATFORM.setSecret(REFRESH_KEY, r.refresh);
    access = r.access; accessUntil = Date.now() + ACCESS_TTL_MS;
    setProfile(r.profile);
    return r.profile;
  }

  async function endSession() {
    access = null; accessUntil = 0;
    await PLATFORM.removeSecret(REFRESH_KEY);
    setProfile(null);
  }

  // Exchanges the refresh token for a new pair. Only one refresh runs at a time (tokens rotate).
  function refresh() {
    if (!refreshing) refreshing = (async () => {
      const token = await PLATFORM.getSecret(REFRESH_KEY);
      if (!token) { await endSession(); throw new ApiError(401, 'session_expired', 'Du er ikke logget ind'); }
      try {
        const r = await call('/auth/refresh', { body: { refresh: token } });
        await PLATFORM.setSecret(REFRESH_KEY, r.refresh);
        access = r.access; accessUntil = Date.now() + ACCESS_TTL_MS;
      } catch (e) {
        if (e.status === 401) await endSession();   // revoked or expired: log in again (local data stays)
        throw e;
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  // Authenticated call: renews the access token when needed and retries once on 401
  async function api(path, opts) {
    if (!access || Date.now() > accessUntil) await refresh();
    try {
      return await call(path, Object.assign({}, opts, { token: access }));
    } catch (e) {
      if (e.status !== 401) throw e;
      await refresh();
      return call(path, Object.assign({}, opts, { token: access }));
    }
  }

  return {
    ApiError,
    required,
    get profile() { return profile; },
    loggedIn: () => !!profile,
    onChange: fn => listeners.push(fn),

    login: async (email, password) => startSession(await call('/auth/login', { body: { email: email.trim(), password } })),
    acceptInvite: async (token, password) => startSession(await call('/auth/accept-invite', { body: { token: token.trim(), password } })),

    async logout() {
      const token = await PLATFORM.getSecret(REFRESH_KEY);
      if (token) { try { await call('/auth/logout', { body: { refresh: token } }); } catch (e) { } }   // best effort offline
      await endSession();
    },

    // At start-up and when the app comes back: refresh the profile if there is network. Never blocks the app.
    async verify() {
      if (!profile) return;
      try { setProfile(await api('/me')); } catch (e) { /* offline: keep the cached profile */ }
    },

    api,
  };
})();

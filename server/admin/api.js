// API client for the admin website (same origin as the API). Only admins and trainers may use the site.
// The refresh token is kept in sessionStorage, so closing the browser tab logs out (shared computers).
'use strict';

const API = (() => {
  const REFRESH_KEY = 'powerkrop-admin-refresh', PROFILE_KEY = 'powerkrop-admin-profile';
  let access = null, until = 0, refreshing = null;
  let profile = null;
  try { profile = JSON.parse(sessionStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { profile = null; }

  class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

  async function call(path, opts) {
    opts = opts || {};
    const headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    let res;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      res = await fetch(path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: 'no-store', signal: ctrl.signal });
    } catch (e) {
      throw new ApiError(0, 'offline', 'Kunne ikke få kontakt til serveren. Tjek forbindelsen, vent et øjeblik, og prøv igen.');
    } finally { clearTimeout(timer); }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'http_' + res.status,
      res.status === 429 ? 'For mange forsøg – vent et minut, og prøv igen' : (data && data.message) || 'Serveren svarede med en fejl (' + res.status + ')');
    return data;
  }

  function setSession(r) {
    access = r.access; until = Date.now() + 14 * 60 * 1000;
    if (r.refresh) sessionStorage.setItem(REFRESH_KEY, r.refresh);
    if (r.profile) { profile = r.profile; sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }
  }
  function clear() {
    access = null; until = 0; profile = null;
    sessionStorage.removeItem(REFRESH_KEY); sessionStorage.removeItem(PROFILE_KEY);
  }

  function refresh() {
    if (!refreshing) refreshing = (async () => {
      const token = sessionStorage.getItem(REFRESH_KEY);
      if (!token) { clear(); throw new ApiError(401, 'session_expired', 'Log ind igen'); }
      try { setSession(await call('/auth/refresh', { body: { refresh: token } })); }
      catch (e) { if (e.status === 401) clear(); throw e; }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function api(path, opts) {
    if (!access || Date.now() > until) await refresh();
    try { return await call(path, Object.assign({}, opts, { token: access })); }
    catch (e) {
      if (e.status !== 401) throw e;
      await refresh();
      return call(path, Object.assign({}, opts, { token: access }));
    }
  }

  return {
    ApiError,
    get profile() { return profile; },
    loggedIn: () => !!profile,
    isAdmin: () => !!profile && profile.role === 'admin',
    async login(email, password) {
      const r = await call('/auth/login', { body: { email: email.trim(), password } });
      if (r.profile.role !== 'admin' && r.profile.role !== 'trainer') {
        await call('/auth/logout', { body: { refresh: r.refresh } }).catch(() => {});
        throw new ApiError(403, 'forbidden', 'Administrationen er kun for admin og trænere. Brug appen på din telefon.');
      }
      setSession(r);
      return r.profile;
    },
    async logout() {
      const token = sessionStorage.getItem(REFRESH_KEY);
      if (token) await call('/auth/logout', { body: { refresh: token } }).catch(() => {});
      clear();
    },
    get: path => api(path),
    post: (path, body) => api(path, { method: 'POST', body: body || {} }),
    put: (path, body) => api(path, { method: 'PUT', body }),
    patch: (path, body) => api(path, { method: 'PATCH', body }),
    del: path => api(path, { method: 'DELETE' }),
  };
})();

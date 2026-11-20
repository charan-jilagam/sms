import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { setCurrency } from './format.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState({});
  const [unread, setUnread] = useState(0);
  const [booting, setBooting] = useState(!!getToken());
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const me = await api.get('/auth/me'); setUser(me.user); setUnread(me.unread);
      const s = await api.get('/system/settings'); setSettings(s); setCurrency(s.currency);
    } catch { setToken(null); setUser(null); }
    finally { setBooting(false); }
  }, []);

  useEffect(() => { if (getToken()) load(); }, [load]);
  useEffect(() => {
    const h = (e) => { setToken(null); setUser(null); if (e.detail) setNotice(e.detail); };
    window.addEventListener('erp:logout', h); return () => window.removeEventListener('erp:logout', h);
  }, []);

  const value = useMemo(() => ({
    user, settings, unread, booting, notice, setUnread, setUser,
    login: async (identifier, password) => { const r = await api.post('/auth/login', { identifier, password }); setToken(r.token); setNotice(''); await load(); return r.user; },
    logout: () => { setToken(null); setUser(null); },
    refreshUnread: async () => { try { const r = await api.get('/auth/me'); setUnread(r.unread); } catch { /* ignore */ } },
    reloadSettings: async () => { const s = await api.get('/system/settings'); setSettings(s); setCurrency(s.currency); },
  }), [user, settings, unread, booting, notice, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

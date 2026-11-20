import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Bell, Moon, Sun, LogOut, GraduationCap, KeyRound, CheckCheck } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { NAV } from '../lib/nav.js';
import { api } from '../lib/api.js';
import { ago, ROLE_LABEL } from '../lib/format.js';
import { useInterval, useLocalState } from '../lib/hooks.js';
import { Avatar } from './ui.jsx';
import { ChildBar, useChild } from '../lib/child.jsx';

function Bell_() {
  const { unread, setUnread } = useAuth();
  const [open, setOpen] = useState(false); const [rows, setRows] = useState([]); const ref = useRef(null); const nav = useNavigate();
  const load = async () => { try { const r = await api.get('/notifications'); setRows(r.rows.slice(0, 8)); setUnread(r.unread); } catch { /* ignore */ } };
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useInterval(() => api.get('/auth/me').then((r) => setUnread(r.unread)).catch(() => {}), 45000);
  const toggle = () => { setOpen(!open); if (!open) load(); };
  const readAll = async () => { await api.post('/notifications/read', { all: true }); load(); };
  const go = async (n) => { if (!n.is_read) await api.post('/notifications/read', { ids: [n.id] }); setOpen(false); if (n.link) nav(n.link); load(); };
  return (
    <div className="bell" ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-icon" onClick={toggle} aria-label="Notifications"><Bell size={18} />{unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}</button>
      {open && (
        <div className="dropdown">
          <div className="row between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}><b>Notifications</b><button className="btn btn-sm btn-ghost" onClick={readAll}><CheckCheck /> Mark all read</button></div>
          {rows.length === 0 && <div className="empty" style={{ padding: 28 }}>You are all caught up.</div>}
          {rows.map((n) => <div key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} onClick={() => go(n)}><span className="dot" style={{ marginTop: 7, opacity: n.is_read ? 0 : 1 }} /><div><b style={{ fontSize: 13.5 }}>{n.title}</b>{n.body && <div className="muted small">{n.body}</div>}<div className="muted small">{ago(n.created_at)}</div></div></div>)}
          <div style={{ padding: 10, textAlign: 'center' }}><button className="btn btn-sm btn-ghost" onClick={() => { setOpen(false); nav('/notifications'); }}>View all</button></div>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout, settings } = useAuth();
  const [open, setOpen] = useState(false); const loc = useLocation(); const nav = useNavigate();
  const [theme, setTheme] = useLocalState('erp_theme', 'light');
  const [menu, setMenu] = useState(false); const mref = useRef(null);
  const { child } = useChild();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => { const h = (e) => mref.current && !mref.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const groups = NAV[user.role] || [];
  const family = user.role === 'parent' || user.role === 'student';
  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><div className="brand-logo"><GraduationCap color="#fff" /></div><div><b>{settings.school_name || 'School ERP'}</b><small>{ROLE_LABEL[user.role]} portal</small></div></div>
        <nav className="nav" aria-label="Main">
          {groups.map((g) => (
            <div className="nav-group" key={g.group}><h6>{g.group}</h6>
              {g.items.map((it) => <NavLink key={it.to + it.label} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><it.icon />{it.label}</NavLink>)}
            </div>))}
        </nav>
        <div className="side-foot small" style={{ opacity: .75 }}>Academic year {settings.academic_year || ''}</div>
      </aside>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="btn btn-icon menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <div className="grow">{family && child && <span className="small muted">Showing <b style={{ color: 'var(--text)' }}>{child.name}</b> · {child.class_label || 'No class'}</span>}</div>
          <button className="btn btn-icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Bell_ />
          <div style={{ position: 'relative' }} ref={mref}>
            <button className="btn" style={{ padding: '5px 12px 5px 6px' }} onClick={() => setMenu(!menu)}><Avatar name={user.name} size="sm" /><span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</span></button>
            {menu && <div className="dropdown" style={{ width: 230 }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}><b>{user.name}</b><div className="muted small">{user.email || user.mobile}</div></div>
              <button className="notif" style={{ width: '100%', border: 0, background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left' }} onClick={() => { setMenu(false); nav('/profile'); }}><KeyRound size={16} /> Profile & password</button>
              <button className="notif" style={{ width: '100%', border: 0, background: 'none', color: 'var(--bad)', font: 'inherit', textAlign: 'left' }} onClick={logout}><LogOut size={16} /> Sign out</button>
            </div>}
          </div>
        </header>
        <main className="content">{family && <ChildBar />}<Outlet /></main>
      </div>
    </div>
  );
}

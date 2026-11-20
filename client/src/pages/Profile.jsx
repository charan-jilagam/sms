import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { api, setToken } from '../lib/api.js';
import { ROLE_LABEL } from '../lib/format.js';
import { Alert, Avatar, Button, Card, Input, PageHead, useToast } from '../components/ui.jsx';

export default function Profile({ forced }) {
  const { user, setUser } = useAuth(); const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setErr('');
    if (f.new_password !== f.confirm) return setErr('The new passwords do not match');
    setBusy(true);
    try { const r = await api.post('/auth/change-password', { current_password: f.current_password, new_password: f.new_password }); setToken(r.token); setUser(r.user); toast('Password updated'); setF({ current_password: '', new_password: '', confirm: '' }); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title={forced ? 'Set a new password' : 'Profile & password'} sub={forced ? 'For your security, please replace the temporary password before continuing.' : undefined} />
      <div className="grid g2">
        <Card title="Account"><div className="row" style={{ gap: 16 }}><Avatar name={user.name} size="lg" /><div><h3>{user.name}</h3><div className="muted">{ROLE_LABEL[user.role]}</div><div className="muted small">{user.email || user.mobile}</div></div></div></Card>
        <Card title="Change password">
          <form className="stack" onSubmit={save}>{forced && <Alert tone="warn">You are signed in with a temporary password.</Alert>}{err && <Alert tone="bad">{err}</Alert>}
            <Input label="Current password" type="password" value={f.current_password} onChange={set('current_password')} required autoComplete="current-password" />
            <Input label="New password" type="password" hint="At least 8 characters" value={f.new_password} onChange={set('new_password')} minLength={8} required autoComplete="new-password" />
            <Input label="Confirm new password" type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" />
            <Button variant="primary" type="submit" loading={busy}>Update password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

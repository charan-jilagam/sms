import { useState } from 'react';
import { GraduationCap, ShieldCheck, Bus, Wallet, CalendarCheck, Bell, LifeBuoy, Users } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { Alert, Button, Input, Select, Tabs } from '../components/ui.jsx';

const DEMO = [
  ['Admin', 'admin@school.test', 'Admin@123'], ['Class teacher', 'anita@school.test', 'Teacher@123'], ['Finance', 'finance@school.test', 'Finance@123'],
  ['Parent', '9000000001', 'Parent@123'], ['Student', 'ADM2026-0001', 'Student@123'], ['Bus driver', 'driver1@school.test', 'Driver@123'],
];

export default function Login() {
  const { login, notice } = useAuth();
  const [tab, setTab] = useState('in'); const [id, setId] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ok, setOk] = useState('');
  const [reg, setReg] = useState({ role: 'parent', name: '', email: '', mobile: '', password: '', admission_no: '' });
  const set = (k) => (v) => setReg((r) => ({ ...r, [k]: v }));

  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(id, pw); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const register = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { ...reg, children: reg.role === 'parent' && reg.admission_no ? [{ admission_no: reg.admission_no }] : [] };
      const r = await api.post('/auth/register', body); setOk(r.message); setTab('in');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="row" style={{ gap: 12 }}><div className="brand-logo"><GraduationCap color="#fff" /></div><b style={{ fontSize: 18 }}>School ERP</b></div>
        <div>
          <h1>One platform for the whole school.</h1>
          <p>Admissions to attendance, fees to buses. Everyone sees exactly what they need, nothing more.</p>
          <div className="feat">
            {[[CalendarCheck, 'Attendance & results'], [Wallet, 'Fees & online payments'], [Bus, 'Live bus tracking'], [Bell, 'Instant notifications'], [LifeBuoy, 'Parent to teacher support'], [ShieldCheck, 'Role-based access']].map(([I, t]) => <div key={t}><I size={18} />{t}</div>)}
          </div>
        </div>
        <small style={{ opacity: .6 }}>Admin · Class teacher · Parent · Student · Driver · Finance</small>
      </section>
      <section className="auth-form">
        <div className="auth-card stack" style={{ gap: 18 }}>
          <div><h2 style={{ fontSize: 26, fontWeight: 800 }}>{tab === 'in' ? 'Welcome back' : 'Create your account'}</h2><p className="muted" style={{ margin: '4px 0 0' }}>{tab === 'in' ? 'Sign in with your email, mobile number or admission number.' : 'New accounts are activated after the school admin approves them.'}</p></div>
          <Tabs tabs={[{ id: 'in', label: 'Sign in' }, { id: 'up', label: 'Register' }]} value={tab} onChange={(t) => { setTab(t); setErr(''); }} />
          {notice && <Alert tone="warn">{notice}</Alert>}{ok && <Alert tone="ok">{ok}</Alert>}{err && <Alert tone="bad">{err}</Alert>}
          {tab === 'in' ? (
            <form className="stack" onSubmit={submit}>
              <Input label="Email, mobile or admission no." value={id} onChange={setId} autoFocus autoComplete="username" required />
              <Input label="Password" type="password" value={pw} onChange={setPw} autoComplete="current-password" required />
              <Button variant="primary" loading={busy} type="submit">Sign in</Button>
            </form>
          ) : (
            <form className="stack" onSubmit={register}>
              <Select label="I am a" value={reg.role} onChange={set('role')} options={[{ value: 'parent', label: 'Parent / guardian' }, { value: 'driver', label: 'Bus driver' }, { value: 'teacher', label: 'Teacher' }, { value: 'finance', label: 'Accounts staff' }]} />
              <Input label="Full name" value={reg.name} onChange={set('name')} required />
              <div className="form-grid"><Input label="Mobile" value={reg.mobile} onChange={set('mobile')} required /><Input label="Email (optional)" type="email" value={reg.email} onChange={set('email')} /></div>
              {reg.role === 'parent' && <Input label="Child's admission number" hint="So the school can link your child quickly. Example: ADM2026-0001" value={reg.admission_no} onChange={set('admission_no')} />}
              <Input label="Password (min 8 characters)" type="password" value={reg.password} onChange={set('password')} minLength={8} required />
              <Button variant="primary" loading={busy} type="submit">Request account</Button>
            </form>
          )}
          {tab === 'in' && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="small muted bold"><Users size={14} style={{ verticalAlign: -2 }} /> Demo accounts (click to fill)</div>
              <div className="demo-grid">{DEMO.map(([n, i, p]) => <button key={n} type="button" className="demo" onClick={() => { setId(i); setPw(p); }}><b>{n}</b><span>{i}</span></button>)}</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

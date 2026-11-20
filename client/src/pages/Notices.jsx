import { useState } from 'react';
import { Plus, Pin, Trash2, Megaphone, CalendarDays, PartyPopper, Palmtree, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { Badge, Button, Card, Empty, FormModal, Input, Loading, PageHead, Select, Tabs, Textarea, useConfirm, useToast } from '../components/ui.jsx';
import { fdate, today, cap } from '../lib/format.js';

const KIND = { notice: [Megaphone, 'info'], event: [PartyPopper, 'ok'], holiday: [Palmtree, 'warn'], circular: [FileText, 'gray'] };

function Calendar() {
  const [m, setM] = useState(today().slice(0, 7)); const { data, loading } = useFetch(`/calendar?month=${m}`, [m]);
  const [y, mo] = m.split('-').map(Number); const first = new Date(y, mo - 1, 1); const days = new Date(y, mo, 0).getDate(); const off = (first.getDay() + 6) % 7;
  const shift = (n) => { const d = new Date(y, mo - 1 + n, 1); setM(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const cells = [...Array(off).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const on = (d) => { const ds = `${m}-${String(d).padStart(2, '0')}`; return (data?.rows || []).filter((e) => e.start_date <= ds && (e.end_date || e.start_date) >= ds); };
  return <Card title={first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} action={<div className="row"><Button size="sm" icon={ChevronLeft} onClick={() => shift(-1)} /><Button size="sm" onClick={() => setM(today().slice(0, 7))}>Today</Button><Button size="sm" icon={ChevronRight} onClick={() => shift(1)} /></div>}>
    {loading && !data ? <Loading /> : <div className="cal">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-h">{d}</div>)}{cells.map((d, i) => <div key={i} className={`cal-c ${d && `${m}-${String(d).padStart(2, '0')}` === today() ? 'today' : ''} ${d ? '' : 'blank'}`}>{d && <><span className="cal-d">{d}</span>{on(d).slice(0, 3).map((e) => <div key={e.id} className={`cal-e ${e.kind}`} title={e.title}>{e.title}</div>)}</>}</div>)}</div>}</Card>;
}

export default function Notices() {
  const { user } = useAuth(); const toast = useToast(); const [ask, node] = useConfirm(); const [tab, setTab] = useState('feed'); const [kind, setKind] = useState('');
  const staff = user.role === 'admin' || user.role === 'teacher'; const { data, loading, reload } = useFetch(`/announcements${kind ? `?kind=${kind}` : ''}`, [kind]);
  const classes = useFetch(staff ? `/classes${user.role === 'teacher' ? '?mine=1' : ''}` : null); const [form, setForm] = useState(null);
  const C = classes.data?.rows || [];
  return (
    <>
      <PageHead title="Notices & events" sub="Announcements, holidays, circulars and the school calendar">{staff && <Button variant="primary" icon={Plus} onClick={() => setForm({ kind: 'notice', title: '', body: '', audience: user.role === 'teacher' ? 'class' : 'all', class_id: C[0]?.id || '', start_date: today(), end_date: '', pinned: false })}>Post</Button>}</PageHead>
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'feed', label: 'Feed' }, { id: 'calendar', label: 'Calendar' }]} /></div>
      {tab === 'calendar' ? <Calendar /> : <>
        <div className="row" style={{ marginBottom: 14 }}>{['', 'notice', 'event', 'holiday', 'circular'].map((k) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k ? cap(k) : 'All'}</button>)}</div>
        {loading ? <Loading /> : !data?.rows.length ? <Card><Empty title="No announcements" icon={Megaphone} /></Card> : <div className="stack">{data.rows.map((a) => { const [I, tone] = KIND[a.kind]; return <Card key={a.id}><div className="row" style={{ alignItems: 'flex-start', gap: 14 }}><div className={`ico b-${tone}`}><I size={20} /></div><div style={{ flex: 1 }}>
          <div className="row between"><div className="row"><b style={{ fontSize: 16 }}>{a.title}</b>{a.pinned ? <Pin size={14} color="var(--brand)" /> : null}<Badge tone={tone}>{cap(a.kind)}</Badge>{a.audience !== 'all' && <Badge>{a.audience === 'class' ? `Class ${a.class_label}` : cap(a.audience)}</Badge>}</div>{staff && (user.role === 'admin' || a.created_by === user.id) && <Button size="sm" variant="danger" icon={Trash2} onClick={async () => { if (await ask({ message: 'Delete this announcement?', danger: true, confirm: 'Delete' })) { await api.del(`/announcements/${a.id}`); reload(); } }} />}</div>
          <div className="muted small" style={{ margin: '4px 0 8px' }}><CalendarDays size={12} /> {fdate(a.start_date)}{a.end_date && a.end_date !== a.start_date ? ` – ${fdate(a.end_date)}` : ''} · {a.author}</div>{a.body && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.body}</p>}</div></div></Card>; })}</div>}</>}
      {form && <FormModal title="Post an announcement" submitLabel="Post & notify" onClose={() => setForm(null)} onSubmit={async () => { const r = await api.post('/announcements', { ...form, class_id: form.audience === 'class' ? form.class_id : null }); setForm(null); reload(); toast(`Posted. ${r.notified} people notified`); }}>
        <div className="form-grid"><Select label="Type" value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={['notice', 'event', 'holiday', 'circular']} />
          {user.role === 'admin' ? <Select label="Audience" value={form.audience} onChange={(v) => setForm({ ...form, audience: v })} options={[{ value: 'all', label: 'Everyone' }, { value: 'parents', label: 'Parents' }, { value: 'students', label: 'Students' }, { value: 'staff', label: 'Staff' }, { value: 'drivers', label: 'Drivers' }, { value: 'class', label: 'One class' }]} /> : <Input label="Audience" value="Your class" disabled />}
          {form.audience === 'class' && <Select full label="Class" value={form.class_id} onChange={(v) => setForm({ ...form, class_id: v })} options={C.map((c) => ({ value: c.id, label: c.label }))} />}
          <Input full label="Title *" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required /><Textarea full label="Details" value={form.body} onChange={(v) => setForm({ ...form, body: v })} rows={4} /><Input label="Starts" type="date" value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /><Input label="Ends (optional)" type="date" value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} />
          {user.role === 'admin' && <label className="row full"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /> Pin to the top</label>}</div></FormModal>}
      {node}
    </>
  );
}

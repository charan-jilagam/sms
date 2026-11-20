import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Plus, Send, ArrowLeft, LifeBuoy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Avatar, Badge, Button, Card, Empty, FormModal, Input, Loading, PageHead, Select, StatusBadge, Table, Tabs, Textarea, useToast } from '../components/ui.jsx';
import { ago, fdatetime, cap } from '../lib/format.js';

const PRI = { low: 'gray', normal: 'info', high: 'bad' };

function Thread({ id }) {
  const { user } = useAuth(); const toast = useToast(); const nav = useNavigate(); const family = user.role === 'parent' || user.role === 'student';
  const { data, loading, reload } = useFetch(`/tickets/${id}`, [id]); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  if (loading) return <Loading />; if (!data) return <Empty title="Ticket not found" />;
  const t = data.ticket; const send = async () => { if (!msg.trim()) return; setBusy(true); try { await api.post(`/tickets/${id}/messages`, { message: msg }); setMsg(''); reload(); } catch (e) { toast(e.message, 'bad'); } setBusy(false); };
  const setStatus = async (s) => { try { await api.put(`/tickets/${id}/status`, { status: s }); reload(); toast('Status updated'); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title={`${t.ticket_no} · ${t.subject}`} sub={`${t.student_name} · raised by ${t.raised_by_name} · assigned to ${t.assigned_to_name || 'Admin'}`}><Button icon={ArrowLeft} onClick={() => nav('/tickets')}>All tickets</Button><StatusBadge status={t.status} /></PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 260px', alignItems: 'start' }}>
        <Card><div className="stack" style={{ gap: 14 }}>{data.messages.map((m) => <div key={m.id} className="row" style={{ alignItems: 'flex-start', flexDirection: m.user_id === user.id ? 'row-reverse' : 'row' }}><Avatar name={m.author} /><div className={`bubble ${m.user_id === user.id ? 'me' : ''}`}><div className="small bold">{m.author} <span className="muted">· {cap(m.role)} · {ago(m.created_at)}</span></div><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.body}</div></div></div>)}</div>
          {t.status !== 'closed' ? <div className="row" style={{ marginTop: 18, alignItems: 'flex-end' }}><div style={{ flex: 1 }}><Textarea placeholder="Write a reply…" value={msg} onChange={setMsg} rows={2} /></div><Button variant="primary" icon={Send} loading={busy} onClick={send}>Send</Button></div> : <p className="muted center" style={{ marginTop: 16 }}>This ticket is closed.</p>}</Card>
        <Card title="Ticket"><dl className="kv"><dt>Status</dt><dd><StatusBadge status={t.status} /></dd><dt>Priority</dt><dd><Badge tone={PRI[t.priority]}>{cap(t.priority)}</Badge></dd><dt>Category</dt><dd>{cap(t.category)}</dd><dt>Opened</dt><dd>{fdatetime(t.created_at)}</dd></dl>
          <div className="stack" style={{ marginTop: 14 }}>{!family && t.status !== 'closed' && <>{t.status !== 'in_progress' && <Button onClick={() => setStatus('in_progress')}>Mark in progress</Button>}{t.status !== 'resolved' && <Button variant="ok" onClick={() => setStatus('resolved')}>Mark resolved</Button>}<Button onClick={() => setStatus('closed')}>Close ticket</Button></>}{family && t.status !== 'closed' && <Button onClick={() => setStatus('closed')}>My issue is solved. Close</Button>}</div></Card></div>
    </>
  );
}

function List() {
  const { user } = useAuth(); const { child } = useChild(); const nav = useNavigate(); const toast = useToast(); const family = user.role === 'parent' || user.role === 'student'; const [tab, setTab] = useState(family ? 'all' : 'open');
  const { data, loading, reload } = useFetch(`/tickets${tab !== 'all' ? `?status=${tab}` : ''}`, [tab]); const [form, setForm] = useState(null);
  const rows = (data?.rows || []).filter((r) => !family || !child || r.student_id === child.id);
  return (
    <>
      <PageHead title="Support tickets" sub={family ? 'Ask the class teacher anything and follow the status here' : 'Questions raised by parents and students'}>{family && child && <Button variant="primary" icon={Plus} onClick={() => setForm({ subject: '', category: 'general', priority: 'normal', message: '' })}>New ticket</Button>}</PageHead>
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All' }, { id: 'open', label: 'Open' }, { id: 'in_progress', label: 'In progress' }, { id: 'resolved', label: 'Resolved' }, { id: 'closed', label: 'Closed' }]} /></div>
      <Card pad={false}><Table loading={loading} rows={rows} onRowClick={(r) => nav(`/tickets/${r.id}`)} empty="No tickets" columns={[{ title: 'Ticket', render: (r) => <div><b>{r.subject}</b><div className="muted small">{r.ticket_no} · {cap(r.category)}</div></div> }, { title: 'Student', key: 'student_name' }, { title: 'Priority', render: (r) => <Badge tone={PRI[r.priority]}>{cap(r.priority)}</Badge> }, { title: 'Assigned to', render: (r) => r.assigned_to_name || 'Admin' }, { title: 'Replies', render: (r) => r.messages - 1, align: 'right' }, { title: 'Updated', render: (r) => ago(r.updated_at) }, { title: 'Status', render: (r) => <StatusBadge status={r.status} /> }]} /></Card>
      {form && <FormModal title={`New ticket for ${child.name}`} submitLabel="Raise ticket" onClose={() => setForm(null)} onSubmit={async () => { const r = await api.post('/tickets', { ...form, student_id: child.id }); setForm(null); toast('Ticket raised'); nav(`/tickets/${r.id}`); }}>
        <div className="form-grid"><Input full label="Subject *" value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} required /><Select label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={['general', 'academics', 'fees', 'transport', 'attendance', 'other']} /><Select label="Priority" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={['low', 'normal', 'high']} /><Textarea full label="Describe the issue *" value={form.message} onChange={(v) => setForm({ ...form, message: v })} rows={5} /></div></FormModal>}
    </>
  );
}
export default function Tickets() { const { id } = useParams(); return id ? <Thread id={id} /> : <List />; }

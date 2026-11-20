import { useState } from 'react';
import { Plus, Pencil, Trash2, Play, Clock, Download, DatabaseBackup, CheckCircle2, XCircle, Star, Mail, MessageSquare } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { Alert, Badge, Button, Card, Empty, FormModal, Input, Loading, PageHead, Select, SearchBox, StatusBadge, Table, Tabs, useConfirm, useToast } from '../components/ui.jsx';
import { IdCard } from './StudentDetail.jsx';
import { fdatetime, ago, cap } from '../lib/format.js';

/* ---------- ID templates ---------- */
function Templates() {
  const toast = useToast(); const [ask, node] = useConfirm(); const { data, loading, reload } = useFetch('/system/id-templates'); const students = useFetch('/students?limit=1'); const sid = students.data?.rows?.[0]?.id;
  const [f, setF] = useState(null); const [sel, setSel] = useState(null); const cur = data?.rows?.find((t) => t.id === sel) || data?.rows?.[0];
  const prev = useFetch(sid && cur ? `/students/${sid}/idcard?template_id=${cur.id}` : null, [sid, cur?.id, cur?.primary_color, cur?.orientation, cur?.footer_text]);
  const blank = { name: '', orientation: 'portrait', primary_color: '#4f46e5', accent_color: '#f59e0b', show_blood_group: 1, show_address: 0, show_guardian: 1, footer_text: '', is_default: 0 };
  return <><div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', alignItems: 'start' }}>
    <Card title="Templates" action={<Button variant="primary" icon={Plus} onClick={() => setF(blank)}>New template</Button>} pad={false}>{loading ? <Loading /> : <Table rows={data.rows} onRowClick={(t) => setSel(t.id)} columns={[{ title: 'Name', render: (t) => <div className="row"><span style={{ width: 16, height: 16, borderRadius: 5, background: t.primary_color, display: 'inline-block' }} /><b>{t.name}</b>{t.is_default ? <Badge tone="ok"><Star size={11} /> Default</Badge> : null}</div> }, { title: 'Layout', render: (t) => cap(t.orientation) },
      { title: '', render: (t) => <div className="row end">{!t.is_default && <Button size="sm" onClick={(e) => { e.stopPropagation(); api.put(`/system/id-templates/${t.id}`, { is_default: 1 }).then(() => { reload(); toast('Default template changed'); }); }}>Make default</Button>}<Button size="sm" icon={Pencil} onClick={(e) => { e.stopPropagation(); setF(t); }} /><Button size="sm" variant="danger" icon={Trash2} onClick={async (e) => { e.stopPropagation(); if (await ask({ message: `Delete "${t.name}"?`, danger: true, confirm: 'Delete' })) { try { await api.del(`/system/id-templates/${t.id}`); reload(); } catch (er) { toast(er.message, 'bad'); } } }} /></div> }]} />}</Card>
    <Card title="Preview">{prev.data ? <div style={{ display: 'flex', justifyContent: 'center' }}><IdCard data={prev.data} /></div> : <Empty title="Add a student to preview" />}</Card></div>
    {f && <FormModal title={f.id ? 'Edit template' : 'New template'} onClose={() => setF(null)} onSubmit={async () => { f.id ? await api.put(`/system/id-templates/${f.id}`, f) : await api.post('/system/id-templates', f); setF(null); reload(); toast('Saved'); }}>
      <div className="form-grid"><Input full label="Template name *" value={f.name} onChange={(v) => setF({ ...f, name: v })} required /><Select label="Layout" value={f.orientation} onChange={(v) => setF({ ...f, orientation: v })} options={['portrait', 'landscape']} /><div /><div className="field"><label>Primary colour</label><input type="color" className="input" value={f.primary_color} onChange={(e) => setF({ ...f, primary_color: e.target.value })} /></div><div className="field"><label>Accent colour</label><input type="color" className="input" value={f.accent_color} onChange={(e) => setF({ ...f, accent_color: e.target.value })} /></div>
        <Input full label="Footer text" value={f.footer_text || ''} onChange={(v) => setF({ ...f, footer_text: v })} placeholder="If found, please return to school office" />
        {[['show_blood_group', 'Show blood group'], ['show_address', 'Show address'], ['show_guardian', 'Show guardian name'], ['is_default', 'Use as default']].map(([k, l]) => <label key={k} className="row"><input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked ? 1 : 0 })} /> {l}</label>)}</div></FormModal>}{node}</>;
}

/* ---------- cron jobs ---------- */
function Jobs() {
  const toast = useToast(); const { data, loading, reload } = useFetch('/system/jobs'); const [busy, setBusy] = useState('');
  const run = async (n) => { setBusy(n); try { const r = await api.post(`/system/jobs/${n}/run`); toast(r.message || 'Job finished'); reload(); } catch (e) { toast(e.message, 'bad'); } setBusy(''); };
  return <div className="stack">{data && !data.cron_enabled && <Alert tone="warn">The scheduler is switched off (<code>ENABLE_CRON=0</code>). Jobs can still be run manually here.</Alert>}
    {loading ? <Loading /> : <div className="grid g2">{data?.rows.map((j) => <Card key={j.name}><div className="row between"><div><b style={{ fontSize: 16 }}>{j.title}</b><div className="muted small mono">{j.name} · cron {j.schedule}</div></div>{j.last_run ? <StatusBadge status={j.last_run.status === 'ok' ? 'success' : j.last_run.status} label={cap(j.last_run.status)} /> : <Badge>Never run</Badge>}</div>
      <p className="muted" style={{ margin: '10px 0' }}>{j.description}</p>{j.last_run && <div className="small"><Clock size={12} /> {ago(j.last_run.finished_at || j.last_run.started_at)} · {j.last_run.message}</div>}
      {j.runs.length > 1 && <div className="row" style={{ gap: 4, marginTop: 10 }}>{j.runs.map((r, i) => <span key={i} title={`${fdatetime(r.started_at)}: ${r.message || r.status}`} className={`dot-step ${r.status === 'ok' ? 'on' : 'bad'}`} />)}</div>}
      <div style={{ marginTop: 12 }}><Button size="sm" icon={Play} loading={busy === j.name} onClick={() => run(j.name)}>Run now</Button></div></Card>)}</div>}</div>;
}

/* ---------- audit ---------- */
function Audit() {
  const [q, setQ] = useState(''); const [page, setPage] = useState(0); const { data, loading } = useFetch(`/system/audit?limit=50&offset=${page * 50}${q ? `&q=${encodeURIComponent(q)}` : ''}`, [q, page]);
  return <Card title="Audit trail" action={<div style={{ width: 260 }}><SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Action, user, entity…" /></div>} pad={false}>
    <Alert>The audit log is append-only. Database triggers block edits and deletes, even for administrators.</Alert>
    <Table loading={loading} rows={data?.rows} empty="No entries" columns={[{ title: 'When', render: (a) => <span className="mono small">{fdatetime(a.created_at)}</span> }, { title: 'Who', render: (a) => a.user_name || 'System' }, { title: 'Action', render: (a) => <Badge>{a.action}</Badge> }, { title: 'Entity', render: (a) => a.entity ? `${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}` : '-' }, { title: 'Details', render: (a) => <span className="muted small mono">{a.details || ''}</span> }]} />
    {data && <div className="row between" style={{ padding: 14 }}><span className="muted small">{data.total} entries</span><div className="row"><Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>Next</Button></div></div>}</Card>;
}

/* ---------- settings ---------- */
function Settings() {
  const { reloadSettings } = useAuth(); const toast = useToast(); const { data, loading } = useFetch('/system/settings'); const [f, setF] = useState(null); const v = f || data || {}; const set = (k) => (x) => setF({ ...v, [k]: x });
  if (loading) return <Loading />;
  return <Card title="School settings"><form onSubmit={async (e) => { e.preventDefault(); try { await api.put('/system/settings', v); await reloadSettings(); toast('Settings saved'); } catch (er) { toast(er.message, 'bad'); } }}>
    <div className="form-grid"><Input full label="School name" value={v.school_name || ''} onChange={set('school_name')} /><Input full label="Address" value={v.school_address || ''} onChange={set('school_address')} /><Input label="Phone" value={v.school_phone || ''} onChange={set('school_phone')} /><Input label="Academic year" value={v.academic_year || ''} onChange={set('academic_year')} placeholder="2026-27" /><Select label="Currency" value={v.currency || 'INR'} onChange={set('currency')} options={['INR', 'USD', 'EUR', 'GBP', 'AED', 'BDT']} />
      <Input label="Late fee % (per overdue invoice)" type="number" value={v.late_fee_percent || ''} onChange={set('late_fee_percent')} hint="Applied once by the late-fee job" /><Input label="Fee reminder days before due" type="number" value={v.reminder_days_before || ''} onChange={set('reminder_days_before')} /><Input label="Fiscal year starts in month (1-12)" type="number" min="1" max="12" value={v.fiscal_start_month || ''} onChange={set('fiscal_start_month')} /></div>
    <div style={{ marginTop: 16 }}><Button variant="primary" type="submit">Save settings</Button></div></form></Card>;
}

/* ---------- backups & outbox ---------- */
function Backups() {
  const toast = useToast(); const { data, loading, reload } = useFetch('/system/backups'); const [busy, setBusy] = useState(false); const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  return <Card title="Database backups" action={<Button variant="primary" icon={DatabaseBackup} loading={busy} onClick={async () => { setBusy(true); try { await api.post('/system/backups'); toast('Backup created'); reload(); } catch (e) { toast(e.message, 'bad'); } setBusy(false); }}>Back up now</Button>} pad={false}>
    <Alert>A consistent online backup runs every night (SQLite backup API; no downtime). Old backups are pruned automatically.</Alert>
    <Table loading={loading} rows={(data?.rows || []).map((b) => ({ ...b, id: b.name }))} empty="No backups yet" columns={[{ title: 'File', render: (b) => <span className="mono">{b.name}</span> }, { title: 'Size', render: (b) => kb(b.size) }, { title: '', render: (b) => <Button size="sm" icon={Download} onClick={() => api.download(`/system/backups/${b.name}`, b.name).catch((e) => toast(e.message, 'bad'))}>Download</Button> }]} /></Card>;
}
function Outbox() {
  const { data, loading } = useFetch('/system/outbox');
  return <Card title="Message outbox (SMS & e-mail)" pad={false}><Alert>No real gateway is connected, so every SMS or e-mail is logged here. Plug a provider into <code>server/src/utils/notify.js</code> to send them for real.</Alert>
    <Table loading={loading} rows={data?.rows} empty="No messages yet" columns={[{ title: '', render: (m) => m.channel === 'sms' ? <MessageSquare size={16} /> : <Mail size={16} /> }, { title: 'To', key: 'to_addr' }, { title: 'Message', render: (m) => <div>{m.subject && <b>{m.subject}</b>}<div className="muted small">{m.body}</div></div> }, { title: 'When', render: (m) => ago(m.created_at) }, { title: 'Status', render: (m) => <StatusBadge status={m.status} /> }]} /></Card>;
}

const TITLES = { templates: ['ID card templates', 'Design the student ID card'], jobs: ['Scheduled jobs', 'Automations that run on a timer (cron)'], audit: ['Audit trail', 'Who did what, and when'], settings: ['Settings', 'School profile, fee rules and fiscal year'] };
export default function System({ tab: initial = 'settings' }) {
  const [tab, setTab] = useState(initial); const [t, s] = TITLES[tab] || TITLES.settings; const group = tab;
  const tabs = [{ id: 'settings', label: 'Settings' }, { id: 'templates', label: 'ID templates' }, { id: 'jobs', label: 'Scheduled jobs' }, { id: 'audit', label: 'Audit trail' }, { id: 'backups', label: 'Backups' }, { id: 'outbox', label: 'Outbox' }];
  return <><PageHead title={t || 'System'} sub={s} /><div style={{ marginBottom: 16 }}><Tabs value={group} onChange={setTab} tabs={tabs} /></div>{tab === 'templates' && <Templates />}{tab === 'jobs' && <Jobs />}{tab === 'audit' && <Audit />}{tab === 'settings' && <Settings />}{tab === 'backups' && <Backups />}{tab === 'outbox' && <Outbox />}</>;
}

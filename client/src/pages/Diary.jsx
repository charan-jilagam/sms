import { useState } from 'react';
import { Plus, Trash2, BookOpen } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Badge, Button, Card, Empty, FormModal, Input, Loading, PageHead, Select, Textarea, useConfirm, useToast } from '../components/ui.jsx';
import { fdate, today } from '../lib/format.js';

export default function Diary() {
  const { user } = useAuth(); const { child } = useChild(); const toast = useToast(); const [ask, node] = useConfirm();
  const staff = user.role === 'admin' || user.role === 'teacher'; const classes = useFetch(staff ? `/classes${user.role === 'teacher' ? '?mine=1' : ''}` : null); const [cid, setCid] = useState('');
  const classId = staff ? (cid || classes.data?.rows?.[0]?.id) : child?.class_id; const subjects = useFetch(classId && staff ? `/classes/${classId}/subjects` : null);
  const { data, loading, reload } = useFetch(classId ? `/diary?class_id=${classId}` : null); const [form, setForm] = useState(null);
  const groups = (data?.rows || []).reduce((a, r) => { (a[r.date] ||= []).push(r); return a; }, {});
  return (
    <>
      <PageHead title="Class diary" sub="Daily notes and homework from teachers">
        {staff && <><div style={{ width: 170 }}><Select value={classId || ''} onChange={setCid} options={(classes.data?.rows || []).map((c) => ({ value: c.id, label: `Class ${c.label}` }))} /></div><Button variant="primary" icon={Plus} onClick={() => setForm({ date: today(), title: '', body: '', subject_id: '', homework_due: '' })}>New entry</Button></>}
      </PageHead>
      {loading ? <Loading /> : !data?.rows.length ? <Card><Empty title="The diary is empty" icon={BookOpen}>{staff ? 'Add the first entry. Parents and students are notified instantly.' : 'Nothing has been written yet.'}</Empty></Card> :
        <div className="stack">{Object.entries(groups).map(([d, rows]) => <div key={d}><div className="muted bold small" style={{ margin: '4px 0 8px' }}>{new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <div className="stack" style={{ gap: 10 }}>{rows.map((r) => <Card key={r.id}><div className="row between"><div className="row" style={{ gap: 10 }}><Badge>{r.subject || 'General'}</Badge><b>{r.title}</b></div><div className="row">{r.homework_due && <Badge tone="warn">Homework due {fdate(r.homework_due)}</Badge>}{staff && (user.role === 'admin' || r.created_by === user.id) && <Button size="sm" variant="danger" icon={Trash2} onClick={async () => { if (await ask({ message: 'Delete this diary entry?', danger: true, confirm: 'Delete' })) { await api.del(`/diary/${r.id}`); reload(); } }} />}</div></div>{r.body && <p style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>{r.body}</p>}<div className="muted small" style={{ marginTop: 8 }}>by {r.author}</div></Card>)}</div></div>)}</div>}
      {form && <FormModal title="New diary entry" onClose={() => setForm(null)} onSubmit={async () => { await api.post('/diary', { ...form, class_id: classId }); setForm(null); reload(); toast('Posted. Families notified'); }}>
        <div className="form-grid"><Input full label="Title *" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required /><Select label="Subject" value={form.subject_id} onChange={(v) => setForm({ ...form, subject_id: v })} placeholder="General" options={(subjects.data?.rows || []).map((s) => ({ value: s.subject_id, label: s.subject }))} /><Input label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          <Textarea full label="Details / homework" value={form.body} onChange={(v) => setForm({ ...form, body: v })} /><Input label="Homework due (optional)" type="date" value={form.homework_due} onChange={(v) => setForm({ ...form, homework_due: v })} /></div></FormModal>}
      {node}
    </>
  );
}

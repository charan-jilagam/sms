import { useEffect, useState } from 'react';
import { Plus, Eye, EyeOff, Save, Trophy, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Alert, Badge, Button, Card, Empty, ErrorBox, FormModal, Input, Loading, PageHead, Progress, Select, Stat, StatusBadge, Table, useConfirm, useToast } from '../components/ui.jsx';
import { fdate } from '../lib/format.js';

function Results() {
  const { child } = useChild(); const { data, loading, error } = useFetch(child ? `/results/student/${child.id}` : null);
  if (!child) return <Empty title="No child selected" />;
  return (
    <>
      <PageHead title="Marks & results" sub={child.name} />
      <ErrorBox error={error} />{loading ? <Loading rows={4} /> : !data?.results.filter((r) => r.subjects.length).length ? <Card><Empty title="No results published yet" icon={Trophy}>You will be notified when the school publishes them.</Empty></Card> :
        <div className="stack">{data.results.filter((r) => r.subjects.length).map((r) => (
          <Card key={r.exam.id} title={r.exam.name} action={<div className="row"><Badge tone={r.result === 'PASS' ? 'ok' : 'bad'}>{r.result}</Badge><Badge>{r.overall}</Badge></div>}>
            <div className="grid g4" style={{ marginBottom: 16 }}><Stat label="Total" value={`${r.total} / ${r.max_total}`} /><Stat label="Percentage" value={`${r.percent}%`} /><Stat label="Class rank" value={r.rank ? `#${r.rank}` : '-'} sub={`of ${r.class_size}`} /><Stat label="Exam date" value={fdate(r.exam.start_date)} /></div>
            <Table rows={r.subjects} rowKey="code" columns={[{ title: 'Subject', render: (x) => <b>{x.subject}</b> }, { title: 'Marks', render: (x) => `${x.marks} / ${x.max}`, align: 'right' }, { title: 'Score', render: (x) => <div style={{ minWidth: 140 }}><Progress value={(x.marks / x.max) * 100} /></div> }, { title: 'Grade', render: (x) => <Badge tone={x.passed ? 'ok' : 'bad'}>{x.grade}</Badge> }, { title: 'Remarks', key: 'remarks' }]} />
          </Card>))}</div>}
    </>
  );
}

function MarksGrid({ exam, onClose }) {
  const { data, loading, reload } = useFetch(`/exams/${exam.id}/marks`); const [vals, setVals] = useState({}); const toast = useToast(); const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setVals(Object.fromEntries(data.marks.map((m) => [`${m.student_id}:${m.subject_id}`, m.marks]))); }, [data]);
  const save = async () => {
    const entries = []; data.students.forEach((s) => data.subjects.filter((x) => x.editable).forEach((sub) => { const k = `${s.id}:${sub.subject_id}`; entries.push({ student_id: s.id, subject_id: sub.subject_id, marks: vals[k] ?? '' }); }));
    setSaving(true); try { const r = await api.put(`/exams/${exam.id}/marks`, { entries }); toast(`Saved ${r.saved} entries`); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setSaving(false); }
  };
  return (
    <Card title={`Marks entry: ${exam.name} (out of ${exam.max_marks})`} action={<div className="row"><Button size="sm" onClick={onClose}>Close</Button><Button size="sm" variant="primary" icon={Save} loading={saving} onClick={save}>Save marks</Button></div>}>
      {loading ? <Loading /> : <><Alert>You can edit the columns for subjects you teach. Leave a cell empty if the student was absent from the exam.</Alert>
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Roll</th><th>Student</th>{data.subjects.map((s) => <th key={s.subject_id}>{s.code}{!s.editable && ' 🔒'}</th>)}<th>Total</th></tr></thead><tbody>
          {data.students.map((s) => { const total = data.subjects.reduce((a, sub) => a + Number(vals[`${s.id}:${sub.subject_id}`] || 0), 0); return <tr key={s.id}><td>{s.roll_no}</td><td><b>{s.name}</b></td>
            {data.subjects.map((sub) => { const k = `${s.id}:${sub.subject_id}`; const bad = vals[k] !== undefined && vals[k] !== '' && Number(vals[k]) > exam.max_marks; return <td key={sub.subject_id}><input className="input" type="number" min="0" max={exam.max_marks} disabled={!sub.editable} value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} style={{ width: 84, padding: '6px 8px', borderColor: bad ? 'var(--bad)' : undefined }} /></td>; })}<td><b className="mono">{total}</b></td></tr>; })}</tbody></table></div></>}
    </Card>
  );
}

export default function Exams() {
  const { user } = useAuth(); const toast = useToast(); const [ask, node] = useConfirm();
  const family = user.role === 'parent' || user.role === 'student';
  const exams = useFetch(family ? null : '/exams'); const classes = useFetch(family ? null : `/classes${user.role === 'teacher' ? '?mine=1' : ''}`); const [open, setOpen] = useState(null); const [form, setForm] = useState(null);
  if (family) return <Results />;
  const cls = classes.data?.rows || []; const ctIds = cls.filter((c) => c.is_ct).map((c) => c.id);
  const canManage = (e) => user.role === 'admin' || ctIds.includes(e.class_id);
  const pub = async (e) => { try { await api.post(`/exams/${e.id}/publish`, { published: e.published ? 0 : 1 }); toast(e.published ? 'Results hidden' : 'Results published and families notified'); exams.reload(); } catch (x) { toast(x.message, 'bad'); } };
  return (
    <>
      <PageHead title="Exams & marks" sub="Create exams, enter marks subject-wise, then publish results to families">{(user.role === 'admin' || ctIds.length > 0) && <Button variant="primary" icon={Plus} onClick={() => setForm({ name: '', class_id: ctIds[0] || cls[0]?.id || '', start_date: '', end_date: '', max_marks: 100 })}>New exam</Button>}</PageHead>
      {open && <div style={{ marginBottom: 16 }}><MarksGrid key={open.id} exam={open} onClose={() => setOpen(null)} /></div>}
      <Card pad={false}><Table loading={exams.loading} rows={exams.data?.rows} empty="No exams yet" columns={[{ title: 'Exam', render: (e) => <b>{e.name}</b> }, { title: 'Class', key: 'class_label' }, { title: 'Dates', render: (e) => `${fdate(e.start_date)}${e.end_date ? ` - ${fdate(e.end_date)}` : ''}` }, { title: 'Max', key: 'max_marks', align: 'right' },
        { title: 'Results', render: (e) => <StatusBadge status={e.published ? 'published' : 'draft'} /> },
        { title: '', render: (e) => <div className="row end"><Button size="sm" onClick={() => setOpen(e)}>Enter marks</Button>{canManage(e) && <Button size="sm" icon={e.published ? EyeOff : Eye} onClick={() => pub(e)}>{e.published ? 'Unpublish' : 'Publish'}</Button>}{user.role === 'admin' && <Button size="sm" variant="danger" icon={Trash2} onClick={async () => { if (await ask({ message: `Delete ${e.name} and all its marks?`, danger: true, confirm: 'Delete' })) { await api.del(`/exams/${e.id}`); exams.reload(); } }} />}</div> }]} /></Card>
      {form && <FormModal title="New exam" onClose={() => setForm(null)} onSubmit={async () => { await api.post('/exams', form); setForm(null); exams.reload(); toast('Exam created'); }}>
        <div className="form-grid"><Input full label="Exam name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. Mid Term" required /><Select label="Class *" value={form.class_id} onChange={(v) => setForm({ ...form, class_id: v })} options={cls.filter((c) => user.role === 'admin' || c.is_ct).map((c) => ({ value: c.id, label: c.label }))} /><Input label="Max marks per subject" type="number" value={form.max_marks} onChange={(v) => setForm({ ...form, max_marks: v })} /><Input label="Starts" type="date" value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /><Input label="Ends" type="date" value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} /></div></FormModal>}
      {node}
    </>
  );
}

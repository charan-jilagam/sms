import { useState } from 'react';
import { Plus, Pencil, Trash2, Settings2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Badge, Button, Card, FormModal, Input, PageHead, Select, Table, Tabs, useConfirm, useToast } from '../components/ui.jsx';

function ClassForm({ c, teachers, onClose, onDone }) {
  const [f, setF] = useState({ name: c?.name || '', section: c?.section || 'A', class_teacher_id: c?.class_teacher_id || '', room: c?.room || '', capacity: c?.capacity || 40 }); const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return <FormModal title={c ? 'Edit class' : 'New class'} onClose={onClose} onSubmit={async () => { const b = { ...f, class_teacher_id: f.class_teacher_id || '' }; c ? await api.put(`/classes/${c.id}`, b) : await api.post('/classes', b); onDone(); }}>
    <div className="form-grid"><Input label="Class / grade *" value={f.name} onChange={set('name')} placeholder="e.g. 6" required /><Input label="Section *" value={f.section} onChange={set('section')} required />
      <Select full label="Class teacher" value={f.class_teacher_id} onChange={set('class_teacher_id')} placeholder="Not assigned" options={teachers.map((t) => ({ value: t.id, label: t.name }))} hint="The class teacher receives leave, change and support requests for this class." />
      <Input label="Room" value={f.room} onChange={set('room')} /><Input label="Capacity" type="number" value={f.capacity} onChange={set('capacity')} /></div></FormModal>;
}

function SubjectAssign({ c, subjects, teachers, onClose }) {
  const cur = useFetch(`/classes/${c.id}/subjects`); const toast = useToast();
  const [rows, setRows] = useState(null);
  const list = rows || (cur.data?.rows || []).map((r) => ({ subject_id: r.subject_id, teacher_id: r.teacher_id || '', periods_per_week: r.periods_per_week }));
  const upd = (i, k, v) => setRows(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const total = list.reduce((a, b) => a + Number(b.periods_per_week || 0), 0);
  return <FormModal title={`Subjects & teachers: Class ${c.label}`} size="wide" onClose={onClose} onSubmit={async () => { await api.put(`/classes/${c.id}/subjects`, { subjects: list }); toast('Saved'); onClose(); }}>
    <div className="table-wrap"><table className="table"><thead><tr><th>Subject</th><th>Teacher</th><th>Periods / week</th><th /></tr></thead><tbody>
      {list.map((r, i) => <tr key={i}><td><select className="input" value={r.subject_id} onChange={(e) => upd(i, 'subject_id', e.target.value)}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
        <td><select className="input" value={r.teacher_id || ''} onChange={(e) => upd(i, 'teacher_id', e.target.value)}><option value="">-</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
        <td style={{ width: 130 }}><input className="input" type="number" min="0" max="12" value={r.periods_per_week} onChange={(e) => upd(i, 'periods_per_week', e.target.value)} /></td>
        <td><Button size="sm" variant="danger" icon={Trash2} type="button" onClick={() => setRows(list.filter((_, j) => j !== i))} /></td></tr>)}</tbody></table></div>
    <div className="row between"><Button type="button" icon={Plus} onClick={() => setRows([...list, { subject_id: subjects.find((s) => !list.some((l) => Number(l.subject_id) === s.id))?.id || subjects[0]?.id, teacher_id: '', periods_per_week: 4 }])}>Add subject</Button><Badge>{total} periods / week in total</Badge></div>
  </FormModal>;
}

function Simple({ title, rows, columns, onAdd, onEdit, onDel, loading, addLabel }) {
  return <Card title={title} action={<Button size="sm" variant="primary" icon={Plus} onClick={onAdd}>{addLabel}</Button>} pad={false}><Table loading={loading} rows={rows} columns={[...columns, { title: '', render: (r) => <div className="row end"><Button size="sm" icon={Pencil} onClick={() => onEdit(r)} /><Button size="sm" variant="danger" icon={Trash2} onClick={() => onDel(r)} /></div> }]} /></Card>;
}

export default function Academics() {
  const [tab, setTab] = useState('classes'); const [modal, setModal] = useState(null); const toast = useToast(); const [ask, node] = useConfirm();
  const classes = useFetch('/classes'); const subjects = useFetch('/subjects'); const periods = useFetch('/periods'); const teachers = useFetch('/users/directory/teachers');
  const T = teachers.data?.rows || [];
  const del = async (url, label, reload) => { if (await ask({ title: 'Delete?', message: `Delete ${label}? This cannot be undone.`, danger: true, confirm: 'Delete' })) { try { await api.del(url); toast('Deleted'); reload(); } catch (e) { toast(e.message, 'bad'); } } };
  const done = (reload) => () => { setModal(null); reload(); toast('Saved'); };
  return (
    <>
      <PageHead title="Classes, subjects & periods" sub="Set up the academic structure. The class teacher you pick here receives that class's requests." />
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'classes', label: 'Classes' }, { id: 'subjects', label: 'Subjects' }, { id: 'periods', label: 'Periods & timings' }]} /></div>
      {tab === 'classes' && <Simple title="Classes" addLabel="New class" loading={classes.loading} rows={classes.data?.rows} onAdd={() => setModal({ t: 'class' })} onEdit={(c) => setModal({ t: 'class', c })} onDel={(c) => del(`/classes/${c.id}`, `class ${c.label}`, classes.reload)}
        columns={[{ title: 'Class', render: (c) => <b>{c.label}</b> }, { title: 'Class teacher', render: (c) => c.class_teacher || <Badge tone="warn">Not assigned</Badge> }, { title: 'Room', key: 'room' }, { title: 'Students', render: (c) => `${c.students} / ${c.capacity}` },
          { title: 'Subjects', render: (c) => <Button size="sm" icon={Settings2} onClick={() => setModal({ t: 'subjects', c })}>Subjects & teachers</Button> }]} />}
      {tab === 'subjects' && <Simple title="Subjects" addLabel="New subject" loading={subjects.loading} rows={subjects.data?.rows} onAdd={() => setModal({ t: 'subject' })} onEdit={(s) => setModal({ t: 'subject', s })} onDel={(s) => del(`/subjects/${s.id}`, s.name, subjects.reload)} columns={[{ title: 'Subject', render: (s) => <b>{s.name}</b> }, { title: 'Code', render: (s) => <Badge>{s.code}</Badge> }]} />}
      {tab === 'periods' && <Simple title="Periods" addLabel="New period" loading={periods.loading} rows={periods.data?.rows} onAdd={() => setModal({ t: 'period' })} onEdit={(p) => setModal({ t: 'period', p })} onDel={(p) => del(`/periods/${p.id}`, p.name, periods.reload)} columns={[{ title: '#', key: 'seq' }, { title: 'Name', render: (p) => <b>{p.name}</b> }, { title: 'Time', render: (p) => `${p.start_time} - ${p.end_time}` }, { title: 'Type', render: (p) => (p.is_break ? <Badge tone="gray">Break</Badge> : <Badge>Teaching</Badge>) }]} />}
      {modal?.t === 'class' && <ClassForm c={modal.c} teachers={T} onClose={() => setModal(null)} onDone={done(classes.reload)} />}
      {modal?.t === 'subjects' && <SubjectAssign c={modal.c} subjects={subjects.data?.rows || []} teachers={T} onClose={() => { setModal(null); classes.reload(); }} />}
      {modal?.t === 'subject' && <SubjectForm s={modal.s} onClose={() => setModal(null)} onDone={done(subjects.reload)} />}
      {modal?.t === 'period' && <PeriodForm p={modal.p} onClose={() => setModal(null)} onDone={done(periods.reload)} />}
      {node}
    </>
  );
}
function SubjectForm({ s, onClose, onDone }) {
  const [f, setF] = useState({ name: s?.name || '', code: s?.code || '' }); const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return <FormModal title={s ? 'Edit subject' : 'New subject'} onClose={onClose} onSubmit={async () => { s ? await api.put(`/subjects/${s.id}`, f) : await api.post('/subjects', f); onDone(); }}><div className="form-grid"><Input label="Name *" value={f.name} onChange={set('name')} required /><Input label="Code *" value={f.code} onChange={set('code')} required /></div></FormModal>;
}
function PeriodForm({ p, onClose, onDone }) {
  const [f, setF] = useState({ name: p?.name || '', seq: p?.seq || '', start_time: p?.start_time || '09:00', end_time: p?.end_time || '09:45', is_break: !!p?.is_break }); const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return <FormModal title={p ? 'Edit period' : 'New period'} onClose={onClose} onSubmit={async () => { p ? await api.put(`/periods/${p.id}`, f) : await api.post('/periods', f); onDone(); }}><div className="form-grid"><Input label="Name *" value={f.name} onChange={set('name')} /><Input label="Order *" type="number" value={f.seq} onChange={set('seq')} />
    <Input label="Starts" type="time" value={f.start_time} onChange={set('start_time')} /><Input label="Ends" type="time" value={f.end_time} onChange={set('end_time')} /><label className="row full"><input type="checkbox" checked={f.is_break} onChange={(e) => set('is_break')(e.target.checked)} /> This is a break (no lesson)</label></div></FormModal>;
}

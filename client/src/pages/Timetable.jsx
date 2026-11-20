import { useState } from 'react';
import { Wand2, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Alert, Badge, Button, Card, Empty, FormModal, Loading, PageHead, Select, useToast } from '../components/ui.jsx';
import { DAYS } from '../lib/format.js';

function Grid({ rows, periods, days, onCell, showClass }) {
  const colors = {}; let n = 0; rows.forEach((r) => { if (colors[r.subject_id] === undefined) colors[r.subject_id] = n++ % 7; });
  const by = Object.fromEntries(rows.map((r) => [`${r.day}:${r.period_id}`, r]));
  return (
    <div className="table-wrap"><table className="tt"><thead><tr><th />{Array.from({ length: days }, (_, i) => <th key={i}>{DAYS[i + 1]}</th>)}</tr></thead><tbody>
      {periods.map((p) => <tr key={p.id}><th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{p.name}<div className="muted" style={{ fontWeight: 500, textTransform: 'none' }}>{p.start_time}-{p.end_time}</div></th>
        {p.is_break ? <td className="brk" colSpan={days}>{p.name}</td> : Array.from({ length: days }, (_, d) => { const c = by[`${d + 1}:${p.id}`]; return (
          <td key={d} className={c ? `sub-c${colors[c.subject_id]}` : ''} onClick={() => onCell?.(d + 1, p, c)} style={{ cursor: onCell ? 'pointer' : 'default' }}>{c ? <><span className="sub">{c.subject}</span><span className="who">{showClass ? `Class ${c.class_label}` : (c.teacher || '-')}</span></> : <span className="muted">·</span>}</td>); })}</tr>)}
    </tbody></table></div>
  );
}

export default function Timetable() {
  const { user } = useAuth(); const { child } = useChild(); const toast = useToast();
  const admin = user.role === 'admin', teacher = user.role === 'teacher';
  const classes = useFetch(admin ? '/classes' : null); const [cid, setCid] = useState('');
  const classId = admin ? (cid || classes.data?.rows?.[0]?.id) : child?.class_id;
  const path = teacher ? '/timetable?teacher=me' : classId ? `/timetable?class_id=${classId}` : null;
  const { data, loading, reload } = useFetch(path); const [gen, setGen] = useState(null); const [edit, setEdit] = useState(null); const subjects = useFetch(edit ? `/classes/${classId}/subjects` : null);
  const days = data?.rows?.some((r) => r.day === 6) ? 6 : 5;
  const run = async (apply) => { try { const r = await api.post('/timetable/generate', { days: gen.days, apply, class_ids: gen.all ? [] : [Number(classId)] }); setGen({ ...gen, result: r }); if (apply) { toast(`Timetable saved: ${r.lessons} lessons`); reload(); } } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title={teacher ? 'My timetable' : 'Timetable'} sub={teacher ? 'Your periods across all classes' : 'Weekly class schedule'}>
        {admin && <><div style={{ width: 170 }}><Select value={classId || ''} onChange={setCid} options={(classes.data?.rows || []).map((c) => ({ value: c.id, label: `Class ${c.label}` }))} /></div><Button variant="primary" icon={Wand2} onClick={() => setGen({ days: 5, all: false })}>Auto-generate</Button></>}
      </PageHead>
      {loading ? <Loading rows={5} /> : !data?.rows.length ? <Card><Empty title="No timetable yet">{admin ? 'Use Auto-generate to build one from the subjects and periods-per-week you configured.' : 'The school has not published a timetable for your class yet.'}</Empty></Card> : <Card><Grid showClass={teacher} rows={data.rows} periods={data.periods} days={days} onCell={admin ? (d, p, c) => setEdit({ d, p, c }) : null} /></Card>}
      {admin && !loading && data?.rows.length > 0 && <p className="muted small" style={{ marginTop: 10 }}>Tip: click any cell to change a lesson manually. The system will block teacher clashes.</p>}
      {gen && <FormModal title="Auto-generate timetable" size="wide" submitLabel={gen.result ? 'Save timetable' : 'Preview'} onClose={() => setGen(null)} onSubmit={async () => { if (gen.result && !gen.result.applied) await run(true); else await run(false); }}>
        <Alert>The generator spreads each subject across the week, avoids repeating a subject on the same day and never double-books a teacher. It uses the "periods per week" set in <b>Classes & Subjects</b>.</Alert>
        <div className="form-grid"><Select label="School days" value={gen.days} onChange={(v) => setGen({ ...gen, days: Number(v), result: null })} options={[{ value: 5, label: 'Mon - Fri' }, { value: 6, label: 'Mon - Sat' }]} /><Select label="Generate for" value={gen.all ? 'all' : 'one'} onChange={(v) => setGen({ ...gen, all: v === 'all', result: null })} options={[{ value: 'one', label: 'Selected class only' }, { value: 'all', label: 'All classes' }]} /></div>
        {gen.result && <Alert tone={gen.result.unplaced.length ? 'warn' : 'ok'}>{gen.result.applied ? 'Saved. ' : 'Preview ready. '}{gen.result.lessons} lessons placed across {gen.result.classes} class(es).{gen.result.unplaced.length ? ` ${gen.result.unplaced.length} lesson group(s) could not be placed (not enough free slots or teacher clashes). Reduce periods per week or add teachers.` : ' No clashes.'}</Alert>}
      </FormModal>}
      {edit && <FormModal title={`${DAYS[edit.d]} · ${edit.p.name}`} onClose={() => setEdit(null)} onSubmit={async () => { await api.put('/timetable/slot', { class_id: classId, day: edit.d, period_id: edit.p.id, subject_id: edit.sid || edit.c?.subject_id }); setEdit(null); reload(); toast('Updated'); }}>
        <Select label="Subject" value={edit.sid || edit.c?.subject_id || ''} onChange={(v) => setEdit({ ...edit, sid: v })} placeholder="Choose subject" options={(subjects.data?.rows || []).map((s) => ({ value: s.subject_id, label: `${s.subject} (${s.teacher || 'no teacher'})` }))} />
        {edit.c && <Button variant="danger" icon={Trash2} type="button" onClick={async () => { await api.del(`/timetable/slot?class_id=${classId}&day=${edit.d}&period_id=${edit.p.id}`); setEdit(null); reload(); }}>Clear this slot</Button>}
      </FormModal>}
    </>
  );
}

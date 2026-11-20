import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Save, CalendarCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Alert, Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHead, Progress, Select, Stat, Table, Tabs, useToast } from '../components/ui.jsx';
import { BarChart } from '../components/charts.jsx';
import { addDays, fdate, monthLabel, today } from '../lib/format.js';

function Mark({ classId, canMark }) {
  const [date, setDate] = useState(today()); const { data, loading, error, reload } = useFetch(classId ? `/attendance/class/${classId}?date=${date}` : null);
  const [marks, setMarks] = useState({}); const [saving, setSaving] = useState(false); const toast = useToast();
  useEffect(() => { if (data) setMarks(Object.fromEntries(data.rows.map((r) => [r.student_id, r.status || (r.on_approved_leave ? 'L' : 'P')]))); }, [data]);
  const all = (s) => setMarks(Object.fromEntries(data.rows.map((r) => [r.student_id, s])));
  const counts = useMemo(() => Object.values(marks).reduce((a, v) => ({ ...a, [v]: (a[v] || 0) + 1 }), {}), [marks]);
  const save = async () => { setSaving(true); try { const r = await api.post(`/attendance/class/${classId}`, { date, records: data.rows.map((x) => ({ student_id: x.student_id, status: marks[x.student_id] })) }); toast(`Attendance saved${r.absent_alerts ? ` · ${r.absent_alerts} parent alert(s) sent` : ''}`); reload(); } catch (e) { toast(e.message, 'bad'); } finally { setSaving(false); } };
  return (
    <Card title="Daily register" action={<div className="row"><div style={{ width: 160 }}><Input type="date" value={date} max={today()} onChange={setDate} /></div></div>}>
      <ErrorBox error={error} />{loading ? <Loading /> : data && <>
        {data.marked && <Alert tone="ok">Attendance for {fdate(date)} has been recorded. You can still edit it.</Alert>}
        {!canMark && <Alert>You teach this class but are not its class teacher, so the register is read-only.</Alert>}
        <div className="row between" style={{ margin: '12px 0' }}><div className="row"><Badge tone="ok">Present {counts.P || 0}</Badge><Badge tone="bad">Absent {counts.A || 0}</Badge><Badge tone="warn">Leave {counts.L || 0}</Badge></div>
          {canMark && <div className="row"><Button size="sm" onClick={() => all('P')}>All present</Button><Button size="sm" variant="primary" icon={Save} loading={saving} onClick={save}>Save attendance</Button></div>}</div>
        <Table rows={data.rows} rowKey="student_id" empty="No active students in this class" columns={[{ title: 'Roll', key: 'roll_no' }, { title: 'Student', render: (r) => <div><b>{r.name}</b><div className="muted small">{r.admission_no}{r.on_approved_leave ? ' · approved leave' : ''}</div></div> },
          { title: 'Status', render: (r) => <div className="seg">{['P', 'A', 'L'].map((s) => <button key={s} disabled={!canMark} className={`${s.toLowerCase()} ${marks[r.student_id] === s ? 'on' : ''}`} onClick={() => setMarks({ ...marks, [r.student_id]: s })}>{s === 'P' ? 'Present' : s === 'A' ? 'Absent' : 'Leave'}</button>)}</div> }]} />
      </>}
    </Card>
  );
}

function Report({ classId }) {
  const [from, setFrom] = useState(addDays(today(), -30)); const [to, setTo] = useState(today()); const { data, loading } = useFetch(classId ? `/attendance/report?class_id=${classId}&from=${from}&to=${to}` : null); const toast = useToast();
  return (
    <Card title="Attendance report" action={<Button size="sm" icon={Download} onClick={() => api.download(`/attendance/report?class_id=${classId}&from=${from}&to=${to}&format=csv`, 'attendance.csv').catch((e) => toast(e.message, 'bad'))}>CSV</Button>}>
      <div className="row" style={{ marginBottom: 12 }}><div style={{ width: 160 }}><Input type="date" label="From" value={from} onChange={setFrom} /></div><div style={{ width: 160 }}><Input type="date" label="To" value={to} onChange={setTo} /></div></div>
      <Table loading={loading} rows={data?.rows} rowKey="student_id" columns={[{ title: 'Roll', key: 'roll_no' }, { title: 'Student', render: (r) => <b>{r.name}</b> }, { title: 'Present', key: 'present', align: 'right' }, { title: 'Absent', key: 'absent', align: 'right' }, { title: 'Leave', key: 'on_leave', align: 'right' },
        { title: '% (excl. leave)', render: (r) => r.percent == null ? '-' : <div style={{ minWidth: 140 }}><div className="row between small"><b>{r.percent}%</b>{r.percent < 75 && <Badge tone="bad">Low</Badge>}</div><Progress value={r.percent} /></div> }]} />
    </Card>
  );
}

function Family() {
  const { child } = useChild(); const [from, setFrom] = useState(addDays(today(), -92)); const to = today();
  const { data, loading, error } = useFetch(child ? `/attendance/student/${child.id}?from=${from}&to=${to}` : null);
  if (!child) return <Empty title="No child selected" />;
  const s = data?.summary;
  return (
    <>
      <PageHead title="Attendance" sub={`${child.name} · last 3 months (${fdate(from)} to ${fdate(to)})`} />
      <ErrorBox error={error} />{loading ? <Loading /> : data && <>
        <div className="grid g4"><Stat hero icon={CalendarCheck} label="Attendance" value={s.percent == null ? '-' : `${s.percent}%`} sub="Present ÷ (present + absent)" /><Stat tone="ok" label="Present days" value={s.present} /><Stat tone="bad" label="Absent days" value={s.absent} /><Stat tone="warn" label="Approved leave" value={s.on_leave} /></div>
        {s.percent != null && s.percent < 75 && <div style={{ marginTop: 16 }}><Alert tone="bad">Attendance is below 75%. Please speak to the class teacher.</Alert></div>}
        <div className="grid g-main" style={{ marginTop: 16 }}>
          <Card title="By month"><BarChart data={data.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))} series={[{ key: 'present', name: 'Present', color: '#10b981' }, { key: 'absent', name: 'Absent', color: '#ef4444' }, { key: 'on_leave', name: 'Leave', color: '#f59e0b' }]} fmt={(v) => Math.round(v)} /></Card>
          <Card title="Daily record"><div className="heat">{[...data.records].reverse().map((r) => <i key={r.date} className={r.status} title={`${fdate(r.date)}: ${r.status === 'P' ? 'Present' : r.status === 'A' ? 'Absent' : 'Leave'}`} />)}</div><div className="legend" style={{ marginTop: 12 }}><span><i style={{ background: 'var(--ok)' }} />Present</span><span><i style={{ background: 'var(--bad)' }} />Absent</span><span><i style={{ background: 'var(--warn)' }} />Leave</span></div></Card>
        </div>
        <div style={{ marginTop: 16 }}><Card title="Absences & leave" pad={false}><Table rows={data.records.filter((r) => r.status !== 'P')} rowKey="date" empty="No absences. Great!" columns={[{ title: 'Date', render: (r) => fdate(r.date) }, { title: 'Status', render: (r) => <Badge tone={r.status === 'A' ? 'bad' : 'warn'}>{r.status === 'A' ? 'Absent' : 'Leave'}</Badge> }, { title: 'Note', key: 'note' }]} /></Card></div>
      </>}
    </>
  );
}

export default function Attendance() {
  const { user } = useAuth(); const [tab, setTab] = useState('mark'); const [cid, setCid] = useState('');
  const mine = user.role === 'teacher'; const classes = useFetch(user.role === 'admin' || mine ? `/classes${mine ? '?mine=1' : ''}` : null);
  if (user.role === 'parent' || user.role === 'student') return <Family />;
  const list = classes.data?.rows || []; const classId = cid || list[0]?.id; const cur = list.find((c) => String(c.id) === String(classId));
  const canMark = user.role === 'admin' || cur?.is_ct;
  return (
    <>
      <PageHead title="Attendance" sub="Mark the daily register and review attendance by class">
        <div style={{ width: 190 }}><Select value={classId || ''} onChange={setCid} options={list.map((c) => ({ value: c.id, label: `Class ${c.label}${c.is_ct ? ' (CT)' : ''}` }))} /></div>
      </PageHead>
      {!list.length && !classes.loading ? <Card><Empty title="No classes assigned to you yet" /></Card> : <>
        <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'mark', label: 'Mark attendance' }, { id: 'report', label: 'Report' }]} /></div>
        {tab === 'mark' ? <Mark key={classId} classId={classId} canMark={canMark} /> : <Report classId={classId} />}</>}
    </>
  );
}

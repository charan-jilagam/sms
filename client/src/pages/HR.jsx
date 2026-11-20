import { useState } from 'react';
import { Plus, Pencil, Download, Check, X, Wand2, Lock, Banknote, FileText, Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { Alert, Avatar, Badge, Button, Card, Empty, FormModal, Input, Modal, PageHead, Select, SearchBox, Stat, StatusBadge, Table, Tabs, Textarea, useConfirm, useToast } from '../components/ui.jsx';
import { fdate, money, today, cap } from '../lib/format.js';

const TYPES = [{ value: 'teacher', label: 'Teacher' }, { value: 'admin_staff', label: 'Admin staff' }, { value: 'finance', label: 'Finance' }, { value: 'driver', label: 'Driver' }, { value: 'co_driver', label: 'Co-driver' }, { value: 'other', label: 'Other' }];

function EmpForm({ e, onClose, onDone }) {
  const [f, setF] = useState(e || { name: '', mobile: '', type: 'teacher', designation: '', department: '', join_date: today(), address: '', id_proof: '', emergency_contact: '', bank_account: '', basic_salary: 0, allowances: 0, deductions: 0, license_no: '', license_expiry: '', status: 'active' }); const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const drv = f.type === 'driver' || f.type === 'co_driver';
  return <FormModal title={e ? `Edit ${e.name}` : 'Add employee'} size="wide" onClose={onClose} onSubmit={async () => { e ? await api.put(`/hr/employees/${e.id}`, f) : await api.post('/hr/employees', f); onDone(); }}>
    <div className="form-grid"><Input label="Full name *" value={f.name} onChange={set('name')} required /><Input label="Mobile" value={f.mobile || ''} onChange={set('mobile')} /><Select label="Type" value={f.type} onChange={set('type')} options={TYPES} /><Input label="Designation" value={f.designation || ''} onChange={set('designation')} /><Input label="Department" value={f.department || ''} onChange={set('department')} /><Input label="Joining date" type="date" value={f.join_date || ''} onChange={set('join_date')} />
      <Input full label="Address" value={f.address || ''} onChange={set('address')} /><Input label="ID proof (Aadhaar / PAN)" value={f.id_proof || ''} onChange={set('id_proof')} /><Input label="Emergency contact" value={f.emergency_contact || ''} onChange={set('emergency_contact')} />
      {drv && <><Input label="Licence no" value={f.license_no || ''} onChange={set('license_no')} /><Input label="Licence expiry" type="date" value={f.license_expiry || ''} onChange={set('license_expiry')} /></>}
      <Input full label="Bank account" value={f.bank_account || ''} onChange={set('bank_account')} /><Input label="Basic salary / month" type="number" min="0" value={f.basic_salary} onChange={set('basic_salary')} /><Input label="Allowances" type="number" min="0" value={f.allowances} onChange={set('allowances')} /><Input label="Fixed deductions" type="number" min="0" value={f.deductions} onChange={set('deductions')} />
      {e && <Select label="Status" value={f.status} onChange={set('status')} options={['active', 'inactive']} />}</div></FormModal>;
}

function Employees() {
  const { user } = useAuth(); const admin = user.role === 'admin'; const [q, setQ] = useState(''); const [type, setType] = useState(''); const qs = `/hr/employees?${q ? `q=${encodeURIComponent(q)}&` : ''}${type ? `type=${type}` : ''}`;
  const { data, loading, reload } = useFetch(qs, [q, type]); const toast = useToast(); const [f, setF] = useState(null);
  return <><Card pad={false}><div className="row" style={{ padding: 16 }}><div style={{ flex: '1 1 240px' }}><SearchBox value={q} onChange={setQ} placeholder="Name, code or mobile…" /></div><div style={{ width: 170 }}><Select value={type} onChange={setType} placeholder="All types" options={TYPES} /></div><Button icon={Download} onClick={() => api.download(`${qs}${qs.endsWith('?') || qs.endsWith('&') ? '' : '&'}format=csv`, 'employees.csv')} />{admin && <Button variant="primary" icon={Plus} onClick={() => setF({})}>Add employee</Button>}</div>
    <Table loading={loading} rows={data?.rows} empty="No employees" columns={[{ title: 'Employee', render: (e) => <div className="row"><Avatar name={e.name} /><div><b>{e.name}</b><div className="muted small">{e.emp_code} · {e.designation || cap(e.type)}</div></div></div> }, { title: 'Type', render: (e) => <Badge>{cap(e.type)}</Badge> }, { title: 'Contact', render: (e) => <div>{e.mobile || '-'}<div className="muted small">{e.email || 'No login'}</div></div> }, { title: 'Joined', render: (e) => fdate(e.join_date) },
      { title: 'Salary', render: (e) => money(e.basic_salary + e.allowances - e.deductions), align: 'right' }, { title: 'Status', render: (e) => <StatusBadge status={e.status} /> }, { title: '', render: (e) => admin && <Button size="sm" icon={Pencil} onClick={() => setF(e)} /> }]} /></Card>
    {f && <EmpForm e={f.id ? f : null} onClose={() => setF(null)} onDone={() => { setF(null); reload(); toast('Saved'); }} />}</>;
}

const SA = [['P', 'Present', 'ok'], ['A', 'Absent', 'bad'], ['H', 'Half day', 'warn'], ['L', 'Leave', 'info']];
function StaffAttendance() {
  const toast = useToast(); const [d, setD] = useState(today()); const { data, loading, reload } = useFetch(`/hr/attendance?date=${d}`, [d]); const [edit, setEdit] = useState({}); const [busy, setBusy] = useState(false);
  const rows = data?.rows || []; const val = (r) => edit[r.employee_id] ?? r.status;
  const save = async () => { setBusy(true); try { const records = rows.filter((r) => val(r)).map((r) => ({ employee_id: r.employee_id, status: val(r) })); await api.post('/hr/attendance', { date: d, records }); setEdit({}); toast(`Saved ${records.length} records`); reload(); } catch (e) { toast(e.message, 'bad'); } setBusy(false); };
  return <Card title="Staff attendance" action={<div className="row"><div style={{ width: 160 }}><Input type="date" max={today()} value={d} onChange={(v) => { setD(v); setEdit({}); }} /></div><Button onClick={() => setEdit(Object.fromEntries(rows.map((r) => [r.employee_id, r.on_approved_leave ? 'L' : 'P'])))}>Mark all present</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></div>} pad={false}>
    <Table loading={loading} rows={rows.map((r) => ({ ...r, id: r.employee_id }))} columns={[{ title: 'Employee', render: (r) => <div><b>{r.name}</b><div className="muted small">{r.emp_code} · {cap(r.type)}</div></div> }, { title: 'On approved leave', render: (r) => r.on_approved_leave ? <Badge tone="info">Yes</Badge> : '' }, { title: 'Status', render: (r) => <div className="row" style={{ gap: 4 }}>{SA.map(([k, l, t]) => <button key={k} type="button" className={`seg ${val(r) === k ? `on ${t}` : ''}`} onClick={() => setEdit({ ...edit, [r.employee_id]: k })}>{l}</button>)}</div> }]} /></Card>;
}

function StaffLeaves() {
  const toast = useToast(); const [st, setSt] = useState('pending'); const { data, loading, reload } = useFetch(`/hr/leaves${st !== 'all' ? `?status=${st}` : ''}`, [st]); const [dec, setDec] = useState(null);
  return <><div style={{ marginBottom: 14 }}><Tabs value={st} onChange={setSt} tabs={[{ id: 'pending', label: 'Pending' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' }]} /></div>
    <Card pad={false}><Table loading={loading} rows={data?.rows} empty="No leave requests" columns={[{ title: 'Employee', render: (l) => <div><b>{l.employee_name}</b><div className="muted small">{l.emp_code} · {cap(l.type)}</div></div> }, { title: 'Dates', render: (l) => `${fdate(l.from_date)} → ${fdate(l.to_date)}` }, { title: 'Type', render: (l) => <Badge tone={l.leave_type === 'unpaid' ? 'warn' : ''}>{cap(l.leave_type)}</Badge> }, { title: 'Reason', key: 'reason' }, { title: 'Status', render: (l) => <StatusBadge status={l.status} /> },
      { title: '', render: (l) => l.status === 'pending' && <div className="row end"><Button size="sm" variant="ok" icon={Check} onClick={() => setDec({ l, decision: 'approved' })}>Approve</Button><Button size="sm" variant="danger" icon={X} onClick={() => setDec({ l, decision: 'rejected' })}>Reject</Button></div> }]} /></Card>
    {dec && <FormModal title={`${cap(dec.decision)}: ${dec.l.employee_name}`} danger={dec.decision === 'rejected'} submitLabel={cap(dec.decision)} onClose={() => setDec(null)} onSubmit={async () => { await api.post(`/hr/leaves/${dec.l.id}/decide`, { decision: dec.decision, note: dec.note }); setDec(null); reload(); toast('Done'); }}><Textarea label="Note (optional)" value={dec.note || ''} onChange={(v) => setDec({ ...dec, note: v })} /></FormModal>}</>;
}

function Run({ id, onClose, canEdit }) {
  const toast = useToast(); const { data, loading, reload } = useFetch(`/hr/payroll/runs/${id}`, [id]); const [ask, node] = useConfirm(); const [ed, setEd] = useState(null);
  const run = data?.run; const rows = data?.rows || []; const act = async (what, msg) => { if (!(await ask({ title: cap(what), message: msg, confirm: cap(what) }))) return; try { await api.post(`/hr/payroll/runs/${id}/${what}`); toast('Done'); reload(); } catch (e) { toast(e.message, 'bad'); } };
  return <Modal title={`Payroll ${run?.month || ''}`} size="wide" onClose={onClose} footer={run && <>{run.status === 'draft' && <Button variant="primary" icon={Lock} onClick={() => act('finalize', 'Finalize this run? Payslips become visible to staff and can no longer be edited.')}>Finalize</Button>}{run.status === 'finalized' && <Button variant="ok" icon={Banknote} onClick={() => act('pay', `Mark as paid? ${money(rows.reduce((a, b) => a + b.net, 0))} will be booked as a Payroll expense and staff notified.`)}>Mark as paid</Button>}<Button onClick={onClose}>Close</Button></>}>
    {run && <div className="row between" style={{ marginBottom: 12 }}><StatusBadge status={run.status} /><b>Total net {money(rows.reduce((a, b) => a + b.net, 0))}</b></div>}
    <Table loading={loading} rows={rows} columns={[{ title: 'Employee', render: (p) => <div><b>{p.name}</b><div className="muted small">{p.emp_code} · {cap(p.type)}</div></div> }, { title: 'Days', render: (p) => `${p.present_days}/${p.working_days}` }, { title: 'Basic', render: (p) => money(p.basic), align: 'right' }, { title: 'Allow.', render: (p) => money(p.allowances), align: 'right' }, { title: 'Bonus', render: (p) => money(p.bonus), align: 'right' }, { title: 'Deduct.', render: (p) => money(p.deductions + p.leave_deduction), align: 'right' }, { title: 'Net', render: (p) => <b>{money(p.net)}</b>, align: 'right' },
      { title: '', render: (p) => run?.status === 'draft' && canEdit ? <Button size="sm" icon={Pencil} onClick={() => setEd({ ...p })} /> : <StatusBadge status={p.status} /> }]} />
    {ed && <FormModal title={`Adjust ${ed.name}`} onClose={() => setEd(null)} onSubmit={async () => { await api.put(`/hr/payroll/payslips/${ed.id}`, { bonus: ed.bonus, deductions: ed.deductions }); setEd(null); reload(); }}><div className="form-grid"><Input label="Bonus" type="number" min="0" value={ed.bonus} onChange={(v) => setEd({ ...ed, bonus: v })} /><Input label="Deductions" type="number" min="0" value={ed.deductions} onChange={(v) => setEd({ ...ed, deductions: v })} /></div></FormModal>}{node}</Modal>;
}

function Payroll() {
  const { user } = useAuth(); const toast = useToast(); const { data, loading, reload } = useFetch('/hr/payroll/runs'); const [open, setOpen] = useState(null); const [month, setMonth] = useState(today().slice(0, 7));
  return <><Alert>A draft run is created automatically on the 1st by the <b>payroll-draft</b> job. Attendance and unpaid leave are deducted per day. Review, finalize, then mark paid.</Alert>
    <Card title="Payroll runs" action={<div className="row"><div style={{ width: 150 }}><Input type="month" value={month} onChange={setMonth} /></div><Button variant="primary" icon={Wand2} onClick={async () => { try { await api.post('/hr/payroll/runs', { month }); toast('Draft generated'); reload(); } catch (e) { toast(e.message, 'bad'); } }}>Generate draft</Button></div>} pad={false} className="mt">
      <Table loading={loading} rows={data?.rows} empty="No payroll runs yet" onRowClick={(r) => setOpen(r.id)} columns={[{ title: 'Month', render: (r) => <b>{r.month}</b> }, { title: 'Payslips', key: 'slips', align: 'right' }, { title: 'Net payable', render: (r) => money(r.total_net ?? r.total), align: 'right' }, { title: 'Status', render: (r) => <StatusBadge status={r.status} /> }, { title: '', render: () => <Button size="sm" icon={FileText}>Open</Button> }]} /></Card>
    {open && <Run id={open} canEdit={user.role !== 'driver'} onClose={() => { setOpen(null); reload(); }} />}</>;
}

export default function HR() {
  const { user } = useAuth(); const admin = user.role === 'admin'; const [tab, setTab] = useState(admin ? 'employees' : 'payroll');
  const tabs = [{ id: 'employees', label: 'Employees' }, ...(admin ? [{ id: 'attendance', label: 'Attendance' }, { id: 'leaves', label: 'Leaves' }] : []), { id: 'payroll', label: 'Payroll' }];
  return <><PageHead title="HRMS & payroll" sub="Teaching, non-teaching, drivers and co-drivers" /><div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={tabs} /></div>{tab === 'employees' && <Employees />}{tab === 'attendance' && <StaffAttendance />}{tab === 'leaves' && <StaffLeaves />}{tab === 'payroll' && <Payroll />}</>;
}

import { useState } from 'react';
import { Plus, Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Alert, Badge, Button, Card, Empty, FormModal, Input, Modal, PageHead, Select, StatusBadge, Table, Tabs, Textarea, useToast } from '../components/ui.jsx';
import { fdate, money, today, cap } from '../lib/format.js';

function Slip({ p, emp, onClose }) {
  return <Modal title={`Payslip · ${p.month}`} onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={Printer} onClick={() => window.print()}>Print</Button></>}><div className="print-area">
    <dl className="kv"><dt>Employee</dt><dd><b>{p.name}</b> ({p.emp_code})</dd><dt>Designation</dt><dd>{p.designation || cap(p.type)}</dd><dt>Days paid</dt><dd>{p.present_days} of {p.working_days}</dd><dt>Status</dt><dd><StatusBadge status={p.status} />{p.paid_on && ` on ${fdate(p.paid_on)}`}</dd></dl><hr className="sep" />
    {[['Basic', p.basic], ['Allowances', p.allowances], ['Bonus', p.bonus]].map(([l, v]) => <div key={l} className="row between"><span>{l}</span><span>{money(v)}</span></div>)}
    {[['Fixed deductions', p.deductions], ['Leave deduction', p.leave_deduction]].map(([l, v]) => <div key={l} className="row between"><span className="muted">{l}</span><span>− {money(v)}</span></div>)}<hr className="sep" /><div className="row between"><b>Net pay</b><b style={{ fontSize: 22 }}>{money(p.net)}</b></div></div></Modal>;
}

export default function MyWork() {
  const toast = useToast(); const [tab, setTab] = useState('leave'); const leaves = useFetch('/hr/leaves'); const slips = useFetch('/hr/my/payslips'); const [f, setF] = useState(null); const [slip, setSlip] = useState(null);
  const emp = slips.data?.employee;
  return (
    <>
      <PageHead title="My leave & payslips" sub={emp ? `${emp.name} · ${emp.emp_code}` : ''}>{tab === 'leave' && emp && <Button variant="primary" icon={Plus} onClick={() => setF({ leave_type: 'casual', from_date: today(), to_date: today(), reason: '' })}>Apply for leave</Button>}</PageHead>
      {!slips.loading && !emp && <Alert tone="warn">No HR record is linked to your account yet. Ask the admin to link it.</Alert>}
      <div style={{ margin: '14px 0' }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'leave', label: 'My leave' }, { id: 'pay', label: 'Payslips' }]} /></div>
      {tab === 'leave' ? <Card pad={false}><Table loading={leaves.loading} rows={leaves.data?.rows} empty="No leave applied" columns={[{ title: 'Dates', render: (l) => `${fdate(l.from_date)} → ${fdate(l.to_date)}` }, { title: 'Type', render: (l) => <Badge>{cap(l.leave_type)}</Badge> }, { title: 'Reason', key: 'reason' }, { title: 'Status', render: (l) => <div><StatusBadge status={l.status} />{l.decision_note && <div className="muted small">{l.decision_note}</div>}</div> }, { title: '', render: (l) => l.status === 'pending' && <Button size="sm" onClick={async () => { await api.post(`/hr/leaves/${l.id}/cancel`); leaves.reload(); }}>Cancel</Button> }]} /></Card>
        : <Card pad={false}><Table loading={slips.loading} rows={slips.data?.rows} empty="No payslips published yet" onRowClick={setSlip} columns={[{ title: 'Month', render: (p) => <b>{p.month}</b> }, { title: 'Days', render: (p) => `${p.present_days}/${p.working_days}` }, { title: 'Net pay', render: (p) => money(p.net), align: 'right' }, { title: 'Status', render: (p) => <StatusBadge status={p.status} /> }]} /></Card>}
      {f && <FormModal title="Apply for leave" submitLabel="Send to admin" onClose={() => setF(null)} onSubmit={async () => { await api.post('/hr/leaves', f); setF(null); leaves.reload(); toast('Sent for approval'); }}>
        <div className="form-grid"><Select label="Type" value={f.leave_type} onChange={(v) => setF({ ...f, leave_type: v })} options={['casual', 'sick', 'earned', 'unpaid']} /><div /><Input label="From" type="date" value={f.from_date} onChange={(v) => setF({ ...f, from_date: v, to_date: v > f.to_date ? v : f.to_date })} /><Input label="To" type="date" min={f.from_date} value={f.to_date} onChange={(v) => setF({ ...f, to_date: v })} /><Textarea full label="Reason" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} /></div></FormModal>}
      {slip && <Slip p={slip} onClose={() => setSlip(null)} />}
    </>
  );
}

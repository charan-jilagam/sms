import { useState } from 'react';
import { Plus, Check, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Alert, Badge, Button, Card, FormModal, Input, PageHead, Select, StatusBadge, Table, Tabs, Textarea, useToast } from '../components/ui.jsx';
import { fdate, today } from '../lib/format.js';

export default function Leaves() {
  const { user } = useAuth(); const { child } = useChild(); const toast = useToast();
  const family = user.role === 'parent' || user.role === 'student'; const [tab, setTab] = useState('pending');
  const { data, loading, reload } = useFetch(`/leaves${!family && tab !== 'all' ? `?status=${tab}` : ''}`);
  const [form, setForm] = useState(null); const [decide, setDecide] = useState(null);
  const rows = (data?.rows || []).filter((r) => !family || !child || r.student_id === child.id);
  return (
    <>
      <PageHead title="Leave requests" sub={family ? 'Apply for leave. It goes to the class teacher for approval' : 'Approved leave is marked automatically in the attendance register'}>
        {family && child && <Button variant="primary" icon={Plus} onClick={() => setForm({ from_date: today(), to_date: today(), reason: '' })}>Apply for leave</Button>}
      </PageHead>
      {!family && <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'pending', label: 'Pending' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' }]} /></div>}
      <Card pad={false}><Table loading={loading} rows={rows} empty="No leave requests" columns={[
        { title: 'Student', render: (r) => <div><b>{r.student_name}</b><div className="muted small">{r.class_label}</div></div> },
        { title: 'Dates', render: (r) => <div>{fdate(r.from_date)}{r.to_date !== r.from_date ? ` → ${fdate(r.to_date)}` : ''}</div> }, { title: 'Reason', key: 'reason' },
        { title: 'Requested by', render: (r) => <div>{r.requested_by_name}<div className="muted small">to {r.routed_to_name || 'Admin'}</div></div> },
        { title: 'Status', render: (r) => <div><StatusBadge status={r.status} />{r.decision_note && <div className="muted small">{r.decision_note}</div>}</div> },
        { title: '', render: (r) => r.status !== 'pending' ? null : family ? <Button size="sm" onClick={async () => { await api.post(`/leaves/${r.id}/cancel`); toast('Cancelled'); reload(); }}>Cancel</Button> : <div className="row end"><Button size="sm" variant="ok" icon={Check} onClick={() => setDecide({ r, decision: 'approved' })}>Approve</Button><Button size="sm" variant="danger" icon={X} onClick={() => setDecide({ r, decision: 'rejected' })}>Reject</Button></div> }]} /></Card>
      {form && <FormModal title={`Leave for ${child.name}`} submitLabel="Send request" onClose={() => setForm(null)} onSubmit={async () => { const r = await api.post('/leaves', { ...form, student_id: child.id }); setForm(null); reload(); toast(r.routed_to ? 'Sent to the class teacher' : 'Sent to the admin office'); }}>
        <div className="form-grid"><Input label="From *" type="date" value={form.from_date} onChange={(v) => setForm({ ...form, from_date: v, to_date: v > form.to_date ? v : form.to_date })} /><Input label="To *" type="date" min={form.from_date} value={form.to_date} onChange={(v) => setForm({ ...form, to_date: v })} /><Textarea full label="Reason *" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} /></div></FormModal>}
      {decide && <FormModal title={`${decide.decision === 'approved' ? 'Approve' : 'Reject'} leave: ${decide.r.student_name}`} submitLabel={decide.decision === 'approved' ? 'Approve' : 'Reject'} danger={decide.decision === 'rejected'} onClose={() => setDecide(null)} onSubmit={async () => { await api.post(`/leaves/${decide.r.id}/decide`, { decision: decide.decision, note: decide.note }); setDecide(null); reload(); toast(`Leave ${decide.decision}`); }}>
        {decide.decision === 'approved' && <Alert>The days will be marked <b>Leave</b> in the attendance register and the parent is notified.</Alert>}<Textarea label="Note to parent (optional)" value={decide.note || ''} onChange={(v) => setDecide({ ...decide, note: v })} /></FormModal>}
    </>
  );
}

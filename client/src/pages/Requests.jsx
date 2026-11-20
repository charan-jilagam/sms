import { useState } from 'react';
import { Plus, Check, X, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Alert, Badge, Button, Card, FormModal, Input, PageHead, Select, StatusBadge, Table, Tabs, Textarea, useToast } from '../components/ui.jsx';
import { fdate, cap } from '../lib/format.js';

const FIELDS = [['mobile', 'Mobile number'], ['address', 'Address'], ['guardian_name', 'Guardian name'], ['blood_group', 'Blood group'], ['name', 'Student name (admin approval)'], ['dob', 'Date of birth (admin approval)']];

export default function Requests() {
  const { user } = useAuth(); const { child } = useChild(); const toast = useToast();
  const family = user.role === 'parent' || user.role === 'student'; const [tab, setTab] = useState('pending');
  const { data, loading, reload } = useFetch(`/change-requests${!family && tab !== 'all' ? `?status=${tab}` : ''}`);
  const [form, setForm] = useState(null); const [decide, setDecide] = useState(null);
  const rows = (data?.rows || []).filter((r) => !family || !child || r.student_id === child.id);
  return (
    <>
      <PageHead title="Change requests" sub={family ? 'Ask the school to correct your details. Most go to the class teacher; name and date of birth go to the admin' : 'Review requested corrections to student details'}>
        {family && child && <Button variant="primary" icon={Plus} onClick={() => setForm({ field: 'mobile', new_value: '', reason: '' })}>New request</Button>}
      </PageHead>
      {!family && <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'pending', label: 'Pending' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' }]} /></div>}
      <Card pad={false}><Table loading={loading} rows={rows} empty="No change requests" columns={[
        { title: 'Student', render: (r) => <div><b>{r.student_name}</b><div className="muted small">{r.class_label}</div></div> }, { title: 'Field', render: (r) => <div>{cap(r.field)}<div className="muted small">{r.approver_role === 'admin' ? 'Admin approval' : 'Class teacher'}</div></div> },
        { title: 'Change', render: (r) => <div className="row" style={{ gap: 8 }}><span className="muted">{r.old_value || '(empty)'}</span><ArrowRight size={14} /><b>{r.new_value}</b></div> }, { title: 'Reason', render: (r) => r.reason || '-' }, { title: 'Raised', render: (r) => fdate(r.created_at) },
        { title: 'Status', render: (r) => <div><StatusBadge status={r.status} />{r.decision_note && <div className="muted small">{r.decision_note}</div>}</div> },
        { title: '', render: (r) => r.status !== 'pending' || family ? null : (r.approver_role === 'admin' && user.role !== 'admin') ? <span className="muted small">Waiting for admin</span> : <div className="row end"><Button size="sm" variant="ok" icon={Check} onClick={() => setDecide({ r, decision: 'approved' })}>Approve</Button><Button size="sm" variant="danger" icon={X} onClick={() => setDecide({ r, decision: 'rejected' })}>Reject</Button></div> }]} /></Card>
      {form && <FormModal title={`Request a change for ${child.name}`} submitLabel="Submit request" onClose={() => setForm(null)} onSubmit={async () => { const r = await api.post('/change-requests', { ...form, student_id: child.id }); setForm(null); reload(); toast(`Sent to the ${r.goes_to}`); }}>
        <div className="form-grid"><Select full label="What should change?" value={form.field} onChange={(v) => setForm({ ...form, field: v })} options={FIELDS.map(([value, label]) => ({ value, label }))} />
          <Input full label="New value *" type={form.field === 'dob' ? 'date' : 'text'} value={form.new_value} onChange={(v) => setForm({ ...form, new_value: v })} /><Input full label="Reason" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} /></div></FormModal>}
      {decide && <FormModal title={`${cap(decide.decision)}: ${cap(decide.r.field)}`} submitLabel={cap(decide.decision)} danger={decide.decision === 'rejected'} onClose={() => setDecide(null)} onSubmit={async () => { await api.post(`/change-requests/${decide.r.id}/decide`, { decision: decide.decision, note: decide.note }); setDecide(null); reload(); toast(`Request ${decide.decision}`); }}>
        {decide.decision === 'approved' && <Alert>The student record is updated as soon as you approve.</Alert>}<Textarea label="Note (optional)" value={decide.note || ''} onChange={(v) => setDecide({ ...decide, note: v })} /></FormModal>}
    </>
  );
}

import { useState } from 'react';
import { Plus, Check, X, KeyRound, Link2, UserX, UserCheck, Copy, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Alert, Avatar, Badge, Button, Card, FormModal, Input, Modal, PageHead, Select, SearchBox, StatusBadge, Table, Tabs, useConfirm, useToast } from '../components/ui.jsx';
import { fdatetime, ago, cap, ROLE_LABEL } from '../lib/format.js';

const ROLES = ['admin', 'teacher', 'finance', 'parent', 'driver'].map((r) => ({ value: r, label: ROLE_LABEL[r] || cap(r) }));

function Secret({ title, pwd, onClose }) {
  const toast = useToast();
  return <Modal title={title} size="narrow" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}><Alert tone="warn">Share this temporary password securely. It is shown only once and the user must change it at first login.</Alert>
    <div className="card card-pad center" style={{ marginTop: 14 }}><code style={{ fontSize: 22, letterSpacing: 1 }}>{pwd}</code><div style={{ marginTop: 10 }}><Button size="sm" icon={Copy} onClick={() => { navigator.clipboard?.writeText(pwd); toast('Copied'); }}>Copy</Button></div></div></Modal>;
}

function Links({ u, onClose }) {
  const toast = useToast(); const kids = useFetch(`/users/${u.id}/children`); const stu = useFetch('/students?limit=500&status=active'); const [sid, setSid] = useState(''); const [rel, setRel] = useState('guardian');
  return <Modal title={`Children linked to ${u.name}`} onClose={onClose}>
    <div className="row" style={{ marginBottom: 14 }}><div style={{ flex: 2 }}><Select value={sid} onChange={setSid} placeholder="Link a student…" options={(stu.data?.rows || []).map((s) => ({ value: s.id, label: `${s.name} (${s.admission_no})` }))} /></div><div style={{ flex: 1 }}><Select value={rel} onChange={setRel} options={['father', 'mother', 'guardian']} /></div><Button variant="primary" disabled={!sid} onClick={async () => { try { await api.post(`/users/${u.id}/children`, { student_id: sid, relation: rel }); setSid(''); kids.reload(); } catch (e) { toast(e.message, 'bad'); } }}>Link</Button></div>
    <Table loading={kids.loading} rows={kids.data?.rows} empty="No children linked yet" columns={[{ title: 'Student', render: (k) => <div><b>{k.name}</b><div className="muted small">{k.admission_no} · {k.class_name}</div></div> }, { title: 'Relation', render: (k) => cap(k.relation) }, { title: '', render: (k) => <Button size="sm" variant="danger" onClick={async () => { await api.del(`/users/${u.id}/children/${k.id}`); kids.reload(); }}>Unlink</Button> }]} /></Modal>;
}

export default function Approvals() {
  const toast = useToast(); const [ask, node] = useConfirm(); const [tab, setTab] = useState('pending'); const [q, setQ] = useState(''); const [role, setRole] = useState('');
  const { data, loading, reload } = useFetch(`/users?limit=200${tab !== 'all' ? `&status=${tab}` : ''}${role ? `&role=${role}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`, [tab, role, q]);
  const counts = useFetch('/users?limit=1&status=pending'); const [form, setForm] = useState(null); const [secret, setSecret] = useState(null); const [links, setLinks] = useState(null); const [edit, setEdit] = useState(null);
  const run = async (fn, msg) => { try { const r = await fn(); toast(msg); reload(); counts.reload(); return r; } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title="Accounts & approvals" sub="Approve self-registrations or create accounts directly. Every account needs an active status to sign in"><Button variant="primary" icon={Plus} onClick={() => setForm({ role: 'teacher', name: '', email: '', mobile: '', password: '' })}>Create account</Button></PageHead>
      <div style={{ marginBottom: 14 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'pending', label: `Pending${counts.data?.total ? ` (${counts.data.total})` : ''}` }, { id: 'active', label: 'Active' }, { id: 'inactive', label: 'Deactivated' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' }]} /></div>
      <Card pad={false}><div className="row" style={{ padding: 16 }}><div style={{ flex: '1 1 240px' }}><SearchBox value={q} onChange={setQ} placeholder="Name, email or mobile…" /></div><div style={{ width: 170 }}><Select value={role} onChange={setRole} placeholder="All roles" options={ROLES.concat([{ value: 'student', label: 'Student' }])} /></div></div>
        <Table loading={loading} rows={data?.rows} empty={tab === 'pending' ? 'No registrations waiting' : 'No accounts'} columns={[
          { title: 'User', render: (u) => <div className="row"><Avatar name={u.name} /><div><b>{u.name}</b><div className="muted small">{u.email || u.mobile}</div></div></div> }, { title: 'Role', render: (u) => <Badge>{ROLE_LABEL[u.role] || cap(u.role)}</Badge> },
          { title: 'Details', render: (u) => u.meta?.length ? <div className="small">Children: {u.meta.map((c) => c.admission_no).join(', ')}</div> : <span className="muted">-</span> }, { title: 'Last sign-in', render: (u) => u.last_login_at ? ago(u.last_login_at) : 'Never' }, { title: 'Status', render: (u) => <StatusBadge status={u.status} /> },
          { title: '', render: (u) => <div className="row end">{u.status === 'pending' && <><Button size="sm" variant="ok" icon={Check} onClick={() => run(async () => { const r = await api.post(`/users/${u.id}/approve`); return r; }, 'Approved')}>Approve</Button><Button size="sm" variant="danger" icon={X} onClick={() => run(() => api.post(`/users/${u.id}/reject`), 'Rejected')}>Reject</Button></>}
            {u.status !== 'pending' && <><Button size="sm" icon={Pencil} title="Edit" onClick={() => setEdit({ ...u })} />{u.role === 'parent' && <Button size="sm" icon={Link2} title="Linked children" onClick={() => setLinks(u)} />}<Button size="sm" icon={KeyRound} title="Reset password" onClick={async () => { if (await ask({ message: `Reset the password for ${u.name}? They will be signed out everywhere.`, confirm: 'Reset' })) { const r = await run(() => api.post(`/users/${u.id}/reset-password`), 'Password reset'); if (r) setSecret({ title: `New password for ${u.name}`, pwd: r.temp_password }); } }} />
              {u.status === 'active' ? <Button size="sm" variant="danger" icon={UserX} onClick={async () => { if (await ask({ message: `Deactivate ${u.name}? They are locked out immediately.`, danger: true, confirm: 'Deactivate' })) run(() => api.post(`/users/${u.id}/deactivate`), 'Deactivated'); }} /> : <Button size="sm" variant="ok" icon={UserCheck} onClick={() => run(() => api.post(`/users/${u.id}/activate`), 'Activated')} />}</>}</div> }]} /></Card>
      {form && <FormModal title="Create account" submitLabel="Create" onClose={() => setForm(null)} onSubmit={async () => { const r = await api.post('/users', form); setForm(null); reload(); r.temp_password ? setSecret({ title: 'Account created', pwd: r.temp_password }) : toast('Account created'); }}>
        <Alert>Accounts created here are active immediately. Teachers, drivers and finance staff also get an HR record automatically.</Alert>
        <div className="form-grid"><Select label="Role" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={ROLES} /><Input label="Full name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required /><Input label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} /><Input label="Mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} hint="Parents sign in with their mobile number" /><Input full label="Password (blank = generate one)" value={form.password} onChange={(v) => setForm({ ...form, password: v })} /></div></FormModal>}
      {edit && <FormModal title={`Edit ${edit.name}`} onClose={() => setEdit(null)} onSubmit={async () => { await api.put(`/users/${edit.id}`, edit); setEdit(null); reload(); toast('Saved'); }}><div className="form-grid"><Input full label="Name" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /><Input label="Email" value={edit.email || ''} onChange={(v) => setEdit({ ...edit, email: v })} /><Input label="Mobile" value={edit.mobile || ''} onChange={(v) => setEdit({ ...edit, mobile: v })} /></div></FormModal>}
      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}{links && <Links u={links} onClose={() => setLinks(null)} />}{node}
    </>
  );
}

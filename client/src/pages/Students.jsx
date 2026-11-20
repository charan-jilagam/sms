import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Download, Phone, Copy, KeyRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { Alert, Avatar, Badge, Button, Card, FormModal, Input, PageHead, Select, SearchBox, StatusBadge, Table, Textarea, Modal, useToast } from '../components/ui.jsx';
import { useChild } from '../lib/child.jsx';
import { Navigate } from 'react-router-dom';

export function Credentials({ creds, onClose }) {
  const toast = useToast(); const rows = creds.filter(Boolean);
  const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };
  return (
    <Modal title="Account created" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <Alert tone="warn">Share these temporary passwords now. They are shown only once and must be changed on first sign-in.</Alert>
      <div className="stack" style={{ marginTop: 14 }}>{rows.map((c) => (
        <div key={c.label} className="card card-pad"><b>{c.label}</b>
          <dl className="kv" style={{ marginTop: 8 }}><dt>Login</dt><dd>{c.login}</dd><dt>Temporary password</dt><dd><code>{c.temp_password}</code> <button className="btn btn-sm btn-ghost" onClick={() => copy(c.temp_password)}><Copy /></button></dd></dl></div>))}</div>
    </Modal>
  );
}

function AddStudent({ classes, onClose, onDone }) {
  const [f, setF] = useState({ name: '', mobile: '', gender: '', dob: '', class_id: '', roll_no: '', blood_group: '', guardian_name: '', address: '', create_parent: true });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <FormModal title="Admit a new student" size="wide" submitLabel="Admit student" onClose={onClose} onSubmit={async () => { const r = await api.post('/students', { ...f, class_id: f.class_id || null, roll_no: f.roll_no || null }); onDone(r); }}>
      <div className="form-grid">
        <Input label="Student name *" value={f.name} onChange={set('name')} required />
        <Input label="Guardian mobile *" hint="Mobile + name together identify the student" value={f.mobile} onChange={set('mobile')} required />
        <Select label="Class" value={f.class_id} onChange={set('class_id')} placeholder="Choose class" options={classes.map((c) => ({ value: c.id, label: c.label }))} />
        <Input label="Roll no." type="number" value={f.roll_no} onChange={set('roll_no')} />
        <Select label="Gender" value={f.gender} onChange={set('gender')} placeholder="Select" options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]} />
        <Input label="Date of birth" type="date" value={f.dob} onChange={set('dob')} />
        <Input label="Blood group" value={f.blood_group} onChange={set('blood_group')} placeholder="e.g. O+" />
        <Input label="Guardian name" value={f.guardian_name} onChange={set('guardian_name')} />
        <Textarea full label="Address" value={f.address} onChange={set('address')} />
        <label className="row full"><input type="checkbox" checked={f.create_parent} onChange={(e) => set('create_parent')(e.target.checked)} /> Also create the parent login (uses the guardian mobile)</label>
      </div>
    </FormModal>
  );
}

export default function Students() {
  const { user } = useAuth(); const nav = useNavigate(); const toast = useToast(); const { children, loading: cl } = useChild();
  const [q, setQ] = useState(''); const [cls, setCls] = useState(''); const [status, setStatus] = useState(''); const [add, setAdd] = useState(false); const [creds, setCreds] = useState(null);
  const staff = user.role === 'admin' || user.role === 'teacher' || user.role === 'finance';
  const classes = useFetch(staff ? '/classes' : null);
  const qs = useMemo(() => `/students?limit=300${q ? `&q=${encodeURIComponent(q)}` : ''}${cls ? `&class_id=${cls}` : ''}${status ? `&status=${status}` : ''}`, [q, cls, status]);
  const { data, loading, reload } = useFetch(staff ? qs : null);
  if (!staff) { if (cl) return null; return children.length === 1 ? <Navigate to={`/students/${children[0].id}`} replace /> : <StudentCards list={children} />; }
  return (
    <>
      <PageHead title="Students" sub={`${data?.total ?? '…'} student${data?.total === 1 ? '' : 's'} ${user.role === 'teacher' ? 'in your classes' : 'on roll'}`}>
        <Button icon={Download} onClick={() => api.download(`${qs}&format=csv`, 'students.csv').catch((e) => toast(e.message, 'bad'))}>Export CSV</Button>
        {user.role === 'admin' && <Button variant="primary" icon={Plus} onClick={() => setAdd(true)}>Admit student</Button>}
      </PageHead>
      <Card pad={false}>
        <div className="row" style={{ padding: 16 }}>
          <div style={{ flex: '1 1 260px' }}><SearchBox value={q} onChange={setQ} placeholder="Search name, mobile, admission no…" /></div>
          <div style={{ width: 180 }}><Select value={cls} onChange={setCls} placeholder="All classes" options={(classes.data?.rows || []).map((c) => ({ value: c.id, label: c.label }))} /></div>
          <div style={{ width: 160 }}><Select value={status} onChange={setStatus} placeholder="Any status" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} /></div>
        </div>
        <Table loading={loading} rows={data?.rows} onRowClick={(s) => nav(`/students/${s.id}`)} empty="No students match your filters" columns={[
          { title: 'Student', render: (s) => <div className="row" style={{ gap: 12 }}><Avatar name={s.name} size="sm" /><div><b>{s.name}</b><div className="muted small">{s.admission_no}</div></div></div> },
          { title: 'Class', render: (s) => s.class_label || '-' }, { title: 'Roll', key: 'roll_no' },
          { title: 'Guardian', render: (s) => <div>{s.guardian_name || '-'}<div className="muted small"><Phone size={11} /> {s.mobile}</div></div> },
          { title: 'ID card', key: 'id_card_no' }, { title: 'Status', render: (s) => <StatusBadge status={s.status} /> },
        ]} />
      </Card>
      {add && <AddStudent classes={classes.data?.rows || []} onClose={() => setAdd(false)} onDone={(r) => { setAdd(false); reload(); setCreds([r.student_login && { label: `Student login: ${r.admission_no}`, login: r.student_login.login, temp_password: r.student_login.temp_password }, r.parent_login && { label: 'Parent login', login: r.parent_login.login, temp_password: r.parent_login.temp_password }]); toast(`Admitted ${r.admission_no}`); }} />}
      {creds && <Credentials creds={creds} onClose={() => setCreds(null)} />}
    </>
  );
}

function StudentCards({ list }) {
  const nav = useNavigate();
  return (<><PageHead title="Profile & ID card" />{!list.length ? <Alert tone="warn">No child is linked to your account yet.</Alert> : <div className="grid g3">{list.map((c) => (
    <Card key={c.id}><div className="row" style={{ gap: 14 }}><Avatar name={c.name} size="lg" /><div className="grow"><h3>{c.name}</h3><div className="muted">{c.class_label} · {c.admission_no}</div></div></div><hr className="sep" /><Button block onClick={() => nav(`/students/${c.id}`)}>Open profile</Button></Card>))}</div>}</>);
}

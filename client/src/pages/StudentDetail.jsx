import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, UserX, UserCheck, Pencil, KeyRound, Link2, Bus, Phone, Trash2, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { Alert, Avatar, Badge, Button, Card, Empty, FormModal, Input, Loading, PageHead, Select, StatusBadge, Tabs, Textarea, useConfirm, useToast, ErrorBox } from '../components/ui.jsx';
import { fdate } from '../lib/format.js';
import { Credentials } from './Students.jsx';

// deterministic pseudo-QR (visual only; encodes the card number in the pattern)
function Qr({ text }) {
  const cells = useMemo(() => { let h = 2166136261; for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } const out = []; for (let i = 0; i < 441; i++) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; const x = i % 21, y = Math.floor(i / 21); const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13); out.push(finder ? (x % 6 === 0 || y % 6 === 0 || (x % 6 > 1 && x % 6 < 5 && y % 6 > 1 && y % 6 < 5) || (x > 13 && (x - 14) % 6 === 0)) : (h & 1)); } return out; }, [text]);
  return <div className="qr" aria-hidden>{cells.map((c, i) => <i key={i} className={c ? '' : 'o'} />)}</div>;
}

export function IdCard({ data }) {
  const { student: s, template: t, school } = data; const land = t?.orientation === 'landscape'; const col = t?.primary_color || '#4f46e5'; const acc = t?.accent_color || '#f59e0b';
  const meta = (<div className="meta"><div>Class</div><span>{s.class_label || '-'}</span><div>Admission</div><span>{s.admission_no}</span><div>DOB</div><span>{fdate(s.dob)}</span>{t?.show_blood_group ? <><div>Blood</div><span>{s.blood_group || '-'}</span></> : null}{t?.show_guardian ? <><div>Guardian</div><span>{s.guardian_name || '-'}</span></> : null}<div>Mobile</div><span>{s.mobile}</span>{t?.show_address ? <><div>Address</div><span>{s.address || '-'}</span></> : null}</div>);
  return (
    <div className={`idcard ${land ? 'landscape' : ''}`}>
      <div className="top" style={{ background: `linear-gradient(135deg, ${col}, ${acc})` }}><b>{school.school_name}</b><small>Student identity card</small></div>
      <div className="body"><div className="photo" style={{ color: col }}>{s.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</div><h4>{s.name}</h4><div style={{ color: col, fontWeight: 800, fontSize: 12 }}>{s.id_card_no}</div>{meta}<Qr text={data.qr} /></div>
      <div className="foot" style={{ background: col }}>{t?.footer_text}{school.school_phone ? ` · ${school.school_phone}` : ''}</div>
    </div>
  );
}

function EditModal({ s, role, onClose, onDone, classes }) {
  const [f, setF] = useState({ name: s.name, mobile: s.mobile, dob: s.dob || '', gender: s.gender || '', blood_group: s.blood_group || '', address: s.address || '', guardian_name: s.guardian_name || '', class_id: s.class_id || '', roll_no: s.roll_no || '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v })); const admin = role === 'admin';
  return (
    <FormModal title={admin ? 'Edit student' : 'Update details'} size="wide" onClose={onClose} onSubmit={async () => { await api.put(`/students/${s.id}`, { ...f, class_id: f.class_id || null, roll_no: f.roll_no || null }); onDone(); }}>
      {!admin && <Alert>Class teachers can correct address, guardian, blood group and roll number. Name, mobile and date of birth changes go through the request workflow.</Alert>}
      <div className="form-grid">
        {admin && <><Input label="Name" value={f.name} onChange={set('name')} /><Input label="Guardian mobile" value={f.mobile} onChange={set('mobile')} /><Select label="Class" value={f.class_id} onChange={set('class_id')} placeholder="None" options={classes.map((c) => ({ value: c.id, label: c.label }))} />
          <Input label="Date of birth" type="date" value={f.dob} onChange={set('dob')} /><Select label="Gender" value={f.gender} onChange={set('gender')} placeholder="-" options={['male', 'female', 'other']} /></>}
        <Input label="Roll no." type="number" value={f.roll_no} onChange={set('roll_no')} /><Input label="Blood group" value={f.blood_group} onChange={set('blood_group')} /><Input label="Guardian name" value={f.guardian_name} onChange={set('guardian_name')} /><Textarea full label="Address" value={f.address} onChange={set('address')} />
      </div>
    </FormModal>
  );
}

function ParentLinks({ s, reload }) {
  const [open, setOpen] = useState(false); const [uid, setUid] = useState(''); const [ask, node] = useConfirm(); const toast = useToast();
  const parents = useFetch(open ? '/users?role=parent&status=active&limit=200' : null);
  return (<>
    <div className="row between" style={{ marginBottom: 8 }}><b>Linked parent accounts</b><Button size="sm" icon={Link2} onClick={() => setOpen(true)}>Link parent</Button></div>
    {!s.parents?.length ? <span className="muted">No parent account linked.</span> : <div className="list">{s.parents.map((p) => <div className="list-item" key={p.id}><Avatar name={p.name} size="sm" /><div className="grow"><b>{p.name}</b> <span className="muted small">({p.relation})</span><div className="muted small">{p.mobile} {p.email}</div></div>
      <Button size="sm" variant="danger" icon={Trash2} onClick={async () => { if (await ask({ message: `Unlink ${p.name} from ${s.name}?`, danger: true, confirm: 'Unlink' })) { await api.del(`/users/${p.id}/children/${s.id}`); toast('Unlinked'); reload(); } }} /></div>)}</div>}
    {open && <FormModal title="Link a parent account" onClose={() => setOpen(false)} onSubmit={async () => { await api.post(`/users/${uid}/children`, { student_id: s.id }); toast('Parent linked'); setOpen(false); reload(); }}>
      <Select label="Parent account" value={uid} onChange={setUid} placeholder="Choose…" options={(parents.data?.rows || []).map((p) => ({ value: p.id, label: `${p.name} (${p.mobile || p.email})` }))} /></FormModal>}
    {node}
  </>);
}

function Deactivate({ s, onClose, onDone, activate }) {
  const [reason, setReason] = useState('');
  return <FormModal title={activate ? 'Reactivate student' : 'Deactivate student'} danger={!activate} submitLabel={activate ? 'Reactivate' : 'Deactivate'} onClose={onClose}
    onSubmit={async () => { await api.post(`/students/${s.id}/${activate ? 'activate' : 'deactivate'}`, { reason }); onDone(); }}>
    {activate ? <p>{s.name} will be able to sign in again and appear in registers.</p> : <><Alert tone="warn">The student's login stops working immediately and they are removed from attendance registers. Parents are notified. Records are kept.</Alert><Textarea label="Reason *" value={reason} onChange={setReason} required /></>}
  </FormModal>;
}

function Transport({ s, admin, reload }) {
  const [open, setOpen] = useState(false); const routes = useFetch(open ? '/transport/routes' : null); const [r, setR] = useState(''); const [st, setSt] = useState('');
  const stops = (routes.data?.rows.find((x) => String(x.id) === String(r))?.stops) || [];
  return (<>
    <div className="row between"><b>School transport</b>{admin && <Button size="sm" icon={Bus} onClick={() => setOpen(true)}>{s.transport ? 'Change' : 'Assign'}</Button>}</div>
    {s.transport ? <dl className="kv" style={{ marginTop: 10 }}><dt>Route</dt><dd>{s.transport.route_name}</dd><dt>Via</dt><dd>{s.transport.via || '-'}</dd><dt>Pickup stop</dt><dd>{s.transport.stop_name || '-'} {s.transport.pickup_time && <Badge>{s.transport.pickup_time}</Badge>}</dd></dl> : <p className="muted">Not using school transport.</p>}
    {open && <FormModal title="Assign transport" onClose={() => setOpen(false)} onSubmit={async () => { await api.put(`/transport/students/${s.id}/transport`, { route_id: r || null, stop_id: st || null }); setOpen(false); reload(); }}>
      <Select label="Route" value={r} onChange={(v) => { setR(v); setSt(''); }} placeholder="No transport" options={(routes.data?.rows || []).map((x) => ({ value: x.id, label: `${x.name} (${x.riders} riders)` }))} />
      {r && <Select label="Pickup stop" value={st} onChange={setSt} placeholder="Choose stop" options={stops.map((x) => ({ value: x.id, label: `${x.seq}. ${x.name} ${x.pickup_time || ''}` }))} />}</FormModal>}
  </>);
}

export default function StudentDetail() {
  const { id } = useParams(); const { user } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const { data: s, loading, error, reload } = useFetch(`/students/${id}`); const [tab, setTab] = useState('overview'); const [modal, setModal] = useState(null); const [creds, setCreds] = useState(null);
  const classes = useFetch(user.role === 'admin' ? '/classes' : null); const tpls = useFetch(`/system/id-templates`); const [tpl, setTpl] = useState('');
  const card = useFetch(tab === 'idcard' ? `/students/${id}/idcard${tpl ? `?template_id=${tpl}` : ''}` : null, [tpl]);
  if (loading) return <Loading rows={4} />; if (error) return <ErrorBox error={error} retry={reload} />; if (!s) return null;
  const canManage = s.level === 'admin' || s.level === 'ct'; const family = s.level === 'family';
  const canReactivate = s.level === 'admin' || (s.level === 'ct' && s.deactivated_role !== 'admin');
  const done = (m) => () => { setModal(null); reload(); toast(m); };
  return (
    <>
      {user.role !== 'parent' && user.role !== 'student' && <Button variant="ghost" icon={ArrowLeft} onClick={() => nav(-1)}>Back</Button>}
      <PageHead title={s.name} sub={`${s.class_label || 'No class'} · Admission ${s.admission_no}`}>
        {s.level === 'admin' && <Button icon={KeyRound} onClick={async () => { const r = await api.post(`/students/${s.id}/reset-login`); setCreds([{ label: 'Student login', login: r.login, temp_password: r.temp_password }]); }}>Reset login</Button>}
        {canManage && <Button icon={Pencil} onClick={() => setModal('edit')}>Edit</Button>}
        {canManage && s.status === 'active' && <Button variant="danger" icon={UserX} onClick={() => setModal('deactivate')}>Deactivate</Button>}
        {canManage && s.status === 'inactive' && canReactivate && <Button variant="primary" icon={UserCheck} onClick={() => setModal('activate')}>Reactivate</Button>}
      </PageHead>
      {s.status === 'inactive' && <div style={{ marginBottom: 16 }}><Alert tone="bad"><b>Inactive</b> ({s.deactivated_role === 'admin' ? 'by admin' : 'by class teacher'}): {s.deactivation_reason || 'no reason recorded'}{s.level === 'ct' && s.deactivated_role === 'admin' && ' - only the admin can reactivate.'}</Alert></div>}
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'idcard', label: 'ID card' }, ...(s.level === 'admin' ? [{ id: 'access', label: 'Parents & transport' }] : [{ id: 'transport', label: 'Transport' }])]} /></div>
      {tab === 'overview' && <div className="grid g-main">
        <Card title="Basic details"><dl className="kv">
          <dt>Full name</dt><dd>{s.name}</dd><dt>Admission no.</dt><dd>{s.admission_no}</dd><dt>ID card no.</dt><dd>{s.id_card_no}</dd><dt>Class</dt><dd>{s.class_label || '-'} {s.roll_no && <span className="muted">· Roll {s.roll_no}</span>}</dd>
          <dt>Date of birth</dt><dd>{fdate(s.dob)}</dd><dt>Gender</dt><dd style={{ textTransform: 'capitalize' }}>{s.gender || '-'}</dd><dt>Blood group</dt><dd>{s.blood_group || '-'}</dd>
          <dt>Guardian</dt><dd>{s.guardian_name || '-'}</dd><dt>Guardian mobile</dt><dd><Phone size={13} /> {s.mobile}</dd><dt>Address</dt><dd>{s.address || '-'}</dd><dt>Admitted on</dt><dd>{fdate(s.admitted_on)}</dd><dt>Status</dt><dd><StatusBadge status={s.status} /></dd>
        </dl>{family && <><hr className="sep" /><Alert>Something wrong in these details? Use <b>Change Details</b> in the menu and your class teacher will review it.</Alert></>}</Card>
        <div className="stack">
          <Card title="Class teacher">{s.class_teacher ? <div className="row"><Avatar name={s.class_teacher.name} /><div><b>{s.class_teacher.name}</b><div className="muted small">{s.class_teacher.mobile}</div></div></div> : <span className="muted">Not assigned</span>}</Card>
          {s.level !== 'family' && <Card><ParentLinks s={s} reload={reload} /></Card>}
          <Card><Transport s={s} admin={s.level === 'admin'} reload={reload} /></Card>
        </div>
      </div>}
      {tab === 'idcard' && <Card title="Student ID card" action={<div className="row no-print"><div style={{ width: 200 }}><Select value={tpl} onChange={setTpl} placeholder="Default template" options={(tpls.data?.rows || []).map((t) => ({ value: t.id, label: t.name }))} /></div><Button icon={Printer} onClick={() => window.print()}>Print</Button></div>}>
        <div className="print-area" style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>{card.loading ? <Loading rows={1} /> : card.data && <IdCard data={card.data} />}</div></Card>}
      {tab === 'access' && <div className="grid g2"><Card><ParentLinks s={s} reload={reload} /></Card><Card><Transport s={s} admin reload={reload} /></Card></div>}
      {tab === 'transport' && <Card><Transport s={s} admin={false} reload={reload} /></Card>}
      {modal === 'edit' && <EditModal s={s} role={s.level} classes={classes.data?.rows || []} onClose={() => setModal(null)} onDone={done('Saved')} />}
      {modal === 'deactivate' && <Deactivate s={s} onClose={() => setModal(null)} onDone={done('Student deactivated')} />}
      {modal === 'activate' && <Deactivate s={s} activate onClose={() => setModal(null)} onDone={done('Student reactivated')} />}
      {creds && <Credentials creds={creds} onClose={() => setCreds(null)} />}
    </>
  );
}

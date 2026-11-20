import { useRef, useState } from 'react';
import { Upload, Download, Eye, EyeOff, Trash2, FileText } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { Alert, Badge, Button, Card, FormModal, Input, PageHead, Select, Table, useConfirm, useToast } from '../components/ui.jsx';
import { fdate, fdatetime } from '../lib/format.js';

function Upload_({ classes, subjects, onClose, onDone }) {
  const [f, setF] = useState({ title: '', class_id: classes[0]?.id || '', subject_id: '', visible: false, release_at: '' }); const file = useRef(null); const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return <FormModal title="Upload question paper" onClose={onClose} submitLabel="Upload" onSubmit={async () => {
    const fl = file.current?.files?.[0]; if (!fl) throw new Error('Please choose a file');
    const fd = new FormData(); fd.append('file', fl); fd.append('title', f.title); fd.append('class_id', f.class_id); if (f.subject_id) fd.append('subject_id', f.subject_id); fd.append('visible_to_students', f.visible ? '1' : '0'); if (f.release_at) fd.append('release_at', f.release_at.replace('T', ' ') + ':00');
    await api.upload('/papers', fd); onDone();
  }}>
    <Alert>Papers stay private to teachers until you release them to students.</Alert>
    <div className="form-grid"><Input full label="Title *" value={f.title} onChange={set('title')} placeholder="e.g. Science - Mid Term paper" required />
      <Select label="Class *" value={f.class_id} onChange={set('class_id')} options={classes.map((c) => ({ value: c.id, label: c.label }))} />
      <Select label="Subject" value={f.subject_id} onChange={set('subject_id')} placeholder="General" options={subjects.map((s) => ({ value: s.id, label: s.name }))} />
      <div className="field full"><label>File * (PDF, Word, image - max 10 MB)</label><input ref={file} className="input" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.ppt,.pptx,.txt" /></div>
      <label className="row full"><input type="checkbox" checked={f.visible} onChange={(e) => set('visible')(e.target.checked)} /> Release to students now</label>
      {f.visible && <Input full type="datetime-local" label="Or release automatically at (optional)" value={f.release_at} onChange={set('release_at')} />}</div>
  </FormModal>;
}

export default function Papers() {
  const { user } = useAuth(); const toast = useToast(); const [ask, node] = useConfirm(); const [up, setUp] = useState(false);
  const staff = user.role === 'admin' || user.role === 'teacher';
  const { data, loading, reload } = useFetch('/papers'); const classes = useFetch(staff ? '/classes' + (user.role === 'teacher' ? '?mine=1' : '') : null); const subjects = useFetch(staff ? '/subjects' : null);
  const released = (p) => p.visible_to_students && (!p.release_at || p.release_at <= new Date().toISOString().replace('T', ' ').slice(0, 19));
  return (
    <>
      <PageHead title="Question papers" sub={staff ? 'Upload papers, keep them private, and release them to students when the time comes' : 'Question papers shared by your teachers'}>{staff && <Button variant="primary" icon={Upload} onClick={() => setUp(true)}>Upload paper</Button>}</PageHead>
      <Card pad={false}><Table loading={loading} rows={data?.rows} empty="No question papers" columns={[
        { title: 'Paper', render: (p) => <div className="row" style={{ gap: 12 }}><FileText color="var(--brand)" /><div><b>{p.title}</b><div className="muted small">{p.file_name}</div></div></div> }, { title: 'Class', key: 'class_label' }, { title: 'Subject', render: (p) => p.subject || '-' }, { title: 'Uploaded', render: (p) => <div>{fdate(p.created_at)}<div className="muted small">{p.uploaded_by_name}</div></div> },
        ...(staff ? [{ title: 'Visibility', render: (p) => released(p) ? <Badge tone="ok">Released</Badge> : p.release_at ? <Badge tone="info">Scheduled {fdatetime(p.release_at)}</Badge> : <Badge tone="gray">Private</Badge> }] : []),
        { title: '', render: (p) => <div className="row end"><Button size="sm" icon={Download} onClick={() => api.download(`/papers/${p.id}/download`, p.file_name).catch((e) => toast(e.message, 'bad'))}>Download</Button>
          {staff && <Button size="sm" icon={released(p) ? EyeOff : Eye} onClick={async () => { await api.post(`/papers/${p.id}/release`, { visible: released(p) ? 0 : 1 }); toast(released(p) ? 'Hidden from students' : 'Released to students'); reload(); }}>{released(p) ? 'Hide' : 'Release'}</Button>}
          {staff && <Button size="sm" variant="danger" icon={Trash2} onClick={async () => { if (await ask({ message: `Delete "${p.title}"?`, danger: true, confirm: 'Delete' })) { await api.del(`/papers/${p.id}`); reload(); } }} />}</div> }]} /></Card>
      {up && <Upload_ classes={classes.data?.rows || []} subjects={subjects.data?.rows || []} onClose={() => setUp(false)} onDone={() => { setUp(false); reload(); toast('Uploaded'); }} />}
      {node}
    </>
  );
}

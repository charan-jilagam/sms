import { useState } from 'react';
import { Send, Pin, Trash2, MessageCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { Avatar, Badge, Button, Card, Empty, Loading, PageHead, Select, Textarea, useConfirm, useToast } from '../components/ui.jsx';
import { ago, cap } from '../lib/format.js';

function Comments({ post }) {
  const toast = useToast(); const { data, loading, reload } = useFetch(`/community/${post.id}/comments`); const [t, setT] = useState('');
  return <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>{loading ? <Loading rows={1} /> : <div className="stack" style={{ gap: 10 }}>{data?.rows.map((c) => <div key={c.id} className="row" style={{ alignItems: 'flex-start' }}><Avatar name={c.author} size="sm" /><div className="bubble"><b className="small">{c.author}</b> <span className="muted small">{cap(c.author_role)} · {ago(c.created_at)}</span><div>{c.body}</div></div></div>)}</div>}
    <div className="row" style={{ marginTop: 10 }}><div style={{ flex: 1 }}><input className="input" placeholder="Write a comment…" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && document.getElementById(`cm${post.id}`).click()} /></div><Button id={`cm${post.id}`} size="sm" icon={Send} onClick={async () => { if (!t.trim()) return; try { await api.post(`/community/${post.id}/comments`, { body: t }); setT(''); reload(); } catch (e) { toast(e.message, 'bad'); } }} /></div></div>;
}

export default function Community() {
  const { user } = useAuth(); const toast = useToast(); const [ask, node] = useConfirm(); const staff = user.role === 'admin' || user.role === 'teacher';
  const { data, loading, reload } = useFetch('/community'); const classes = useFetch('/classes' + (user.role === 'teacher' ? '?mine=1' : '')); const [body, setBody] = useState(''); const [cid, setCid] = useState(''); const [open, setOpen] = useState(null);
  const C = classes.data?.rows || [];
  const post = async () => { if (!body.trim()) return; try { await api.post('/community', { body, class_id: cid || null }); setBody(''); reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title="Community" sub="A friendly space for classes, parents and teachers" />
      <Card><Textarea placeholder="Share something with the community…" value={body} onChange={setBody} rows={2} /><div className="row between" style={{ marginTop: 10 }}><div style={{ width: 220 }}><Select value={cid} onChange={setCid} placeholder={staff ? 'Whole school' : 'Choose a class'} options={C.map((c) => ({ value: c.id, label: `Class ${c.label}` }))} /></div><Button variant="primary" icon={Send} onClick={post}>Post</Button></div></Card>
      <div className="stack" style={{ marginTop: 16 }}>{loading ? <Loading /> : !data?.rows.length ? <Card><Empty title="No posts yet" icon={MessageCircle}>Start the conversation.</Empty></Card> : data.rows.map((p) => <Card key={p.id}>
        <div className="row between"><div className="row"><Avatar name={p.author} /><div><b>{p.author}</b> <Badge>{cap(p.author_role)}</Badge><div className="muted small">{ago(p.created_at)} · {p.class_label ? `Class ${p.class_label}` : 'Whole school'}</div></div></div>
          <div className="row">{p.pinned ? <Pin size={15} color="var(--brand)" /> : null}{staff && <Button size="sm" icon={Pin} title="Pin / unpin" onClick={async () => { try { await api.post(`/community/${p.id}/pin`); reload(); } catch (e) { toast(e.message, 'bad'); } }} />}{(user.role === 'admin' || p.author_id === user.id || staff) && <Button size="sm" variant="danger" icon={Trash2} onClick={async () => { if (await ask({ message: 'Delete this post?', danger: true, confirm: 'Delete' })) { try { await api.del(`/community/${p.id}`); reload(); } catch (e) { toast(e.message, 'bad'); } } }} />}</div></div>
        <p style={{ margin: '12px 0', whiteSpace: 'pre-wrap' }}>{p.body}</p><button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === p.id ? null : p.id)}><MessageCircle size={14} /> {p.comments} comment{p.comments === 1 ? '' : 's'}</button>{open === p.id && <Comments post={p} />}</Card>)}</div>
      {node}
    </>
  );
}

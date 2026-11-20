import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { ago, cap } from '../lib/format.js';
import { Badge, Button, Card, Empty, Loading, PageHead } from '../components/ui.jsx';

export default function Notifications() {
  const { data, loading, reload } = useFetch('/notifications'); const nav = useNavigate(); const { refreshUnread } = useAuth();
  const open = async (n) => { if (!n.is_read) { await api.post('/notifications/read', { ids: [n.id] }); refreshUnread(); } if (n.link) nav(n.link); else reload(); };
  return (
    <>
      <PageHead title="Notifications" sub="Fee reminders, leave decisions, bus alerts and school updates"><Button icon={CheckCheck} onClick={async () => { await api.post('/notifications/read', { all: true }); reload(); refreshUnread(); }}>Mark all read</Button></PageHead>
      <Card pad={false}>{loading ? <div className="card-b"><Loading /></div> : !data?.rows.length ? <Empty title="No notifications" icon={Bell} /> :
        data.rows.map((n) => <div key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} onClick={() => open(n)}><span className="dot" style={{ marginTop: 7, opacity: n.is_read ? 0 : 1 }} /><div className="grow"><b>{n.title}</b>{n.body && <div className="muted">{n.body}</div>}<div className="muted small">{ago(n.created_at)}</div></div><Badge>{cap(n.kind)}</Badge></div>)}</Card>
    </>
  );
}

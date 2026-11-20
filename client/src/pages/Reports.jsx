import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Button, Card, Input, PageHead, Select, Table, Tabs, useToast } from '../components/ui.jsx';
import { HBars } from '../components/charts.jsx';
import { money, today, addDays } from '../lib/format.js';

export default function Reports() {
  const toast = useToast(); const [tab, setTab] = useState('collection'); const [from, setFrom] = useState(addDays(today(), -30)); const [to, setTo] = useState(today()); const [group, setGroup] = useState('day');
  const path = tab === 'collection' ? `/reports/fee-collection?from=${from}&to=${to}&group=${group}` : tab === 'outstanding' ? '/reports/outstanding' : tab === 'expenses' ? `/reports/expenses?from=${from}&to=${to}` : '/reports/strength';
  const { data, loading } = useFetch(path, [path]); const rows = data?.rows || [];
  const cols = { collection: [{ title: 'Group', key: 'label' }, { title: 'Payments', key: 'payments', align: 'right' }, { title: 'Total', render: (r) => money(r.total), align: 'right' }],
    outstanding: [{ title: 'Student', render: (r) => <div><b>{r.student}</b><div className="muted small">{r.admission_no} · {r.class}</div></div> }, { title: 'Mobile', key: 'mobile' }, { title: 'Invoices', key: 'invoices', align: 'right' }, { title: 'Balance', render: (r) => <b>{money(r.balance)}</b>, align: 'right' }, { title: 'Days overdue', key: 'days_overdue', align: 'right' }],
    expenses: [{ title: 'Category', key: 'category' }, { title: 'Entries', key: 'entries', align: 'right' }, { title: 'Total', render: (r) => money(r.total), align: 'right' }],
    strength: [{ title: 'Class', key: 'class' }, { title: 'Students', key: 'students', align: 'right' }, { title: 'Boys', key: 'boys', align: 'right' }, { title: 'Girls', key: 'girls', align: 'right' }, { title: 'Capacity', key: 'capacity', align: 'right' }] }[tab];
  const chart = tab === 'collection' && group !== 'day' ? rows.map((r) => ({ label: r.label, value: r.total })) : tab === 'expenses' ? rows.map((r) => ({ label: r.category, value: r.total })) : null;
  return (
    <>
      <PageHead title="Reports" sub="Filter, review and export to CSV"><Button icon={Download} onClick={() => api.download(`${path}${path.includes('?') ? '&' : '?'}format=csv`, `${tab}.csv`).catch((e) => toast(e.message, 'bad'))}>Export CSV</Button></PageHead>
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'collection', label: 'Fee collection' }, { id: 'outstanding', label: 'Outstanding dues' }, { id: 'expenses', label: 'Expenses' }, { id: 'strength', label: 'Class strength' }]} /></div>
      {(tab === 'collection' || tab === 'expenses') && <div className="row" style={{ marginBottom: 16 }}><div style={{ width: 160 }}><Input label="From" type="date" value={from} onChange={setFrom} /></div><div style={{ width: 160 }}><Input label="To" type="date" value={to} onChange={setTo} /></div>{tab === 'collection' && <div style={{ width: 170 }}><Select label="Group by" value={group} onChange={setGroup} options={[{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }, { value: 'method', label: 'Payment mode' }, { value: 'class', label: 'Class' }, { value: 'fee_head', label: 'Fee head' }]} /></div>}</div>}
      <div className="grid g2" style={{ gridTemplateColumns: chart ? '1.4fr 1fr' : '1fr' }}><Card pad={false}><Table loading={loading} rows={rows.map((r, i) => ({ ...r, id: i }))} columns={cols} empty="No data for this selection" />{data?.total != null && <div className="row between" style={{ padding: 14 }}><span className="muted">Total</span><b>{money(data.total)}</b></div>}</Card>
        {chart && <Card title="Breakdown"><HBars data={chart} fmt={money} /></Card>}</div>
    </>
  );
}

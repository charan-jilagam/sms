import { useState } from 'react';
import { Plus, Landmark, Trash2, Pencil, Download, Banknote, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { Alert, Badge, Button, Card, Empty, FormModal, Input, PageHead, Progress, Select, Stat, StatusBadge, Table, Tabs, useConfirm, useToast } from '../components/ui.jsx';
import { BarChart, Legend, Donut, monthData } from '../components/charts.jsx';
import { fdate, fdatetime, money, today, cap } from '../lib/format.js';

const CATS = ['Salaries', 'Utilities', 'Maintenance', 'Transport', 'Stationery', 'Events', 'Software', 'Other'];

function Overview() {
  const { data, loading } = useFetch('/finance/overview'); if (loading || !data) return <Card><div className="skeleton" style={{ height: 200 }} /></Card>;
  const S = [{ key: 'collected', label: 'Collected', color: '#4f46e5' }, { key: 'expenses', label: 'Expenses', color: '#f59e0b' }];
  return <div className="stack">
    <div className="grid g4"><Stat hero label="Collected this month" value={money(data.collectedMonth)} sub={`Today ${money(data.collectedToday)}`} /><Stat tone="bad" label="Outstanding" value={money(data.outstanding)} sub={`${money(data.overdue)} overdue`} /><Stat label="Expenses this month" value={money(data.expensesMonth)} /><Stat tone={data.net >= 0 ? 'ok' : 'bad'} label="Net this month" value={money(data.net)} /></div>
    {(data.undeposited.n > 0 || data.pendingDeposits.n > 0) && <Alert tone="warn"><Banknote /><div>{data.undeposited.n > 0 && <div><b>{money(data.undeposited.t)}</b> of cash ({data.undeposited.n} receipts) is still not banked.</div>}{data.pendingDeposits.n > 0 && <div><b>{data.pendingDeposits.n}</b> bank deposit(s) worth {money(data.pendingDeposits.t)} await verification.</div>}</div></Alert>}
    <div className="grid g2"><Card title="Collections vs expenses (6 months)"><BarChart data={monthData(data.series)} series={S} /><Legend series={S} /></Card>
      <Card title="Collected this month by mode">{data.byMethod.length ? <Donut data={data.byMethod.map((m) => ({ label: cap(m.method), value: m.total }))} center={money(data.collectedMonth)} /> : <Empty title="No collections yet this month" />}</Card></div></div>;
}

function CashBook() {
  const [d, setD] = useState(today()); const { data, loading } = useFetch(`/finance/cashbook?date=${d}`, [d]);
  return <Card title="Daily cash book" action={<div style={{ width: 160 }}><Input type="date" value={d} onChange={setD} /></div>} pad={false}>
    {data && <div className="grid g3" style={{ padding: 16 }}><Stat label="Total collected" value={money(data.total)} /><Stat label="Cash in hand" value={money(data.cash_total)} /><Stat tone="warn" label="Cash not yet banked (all days)" value={money(data.undeposited.t)} sub={`${data.undeposited.n} receipts`} /></div>}
    <Table loading={loading} rows={data?.rows} empty="No collections on this day" columns={[{ title: 'Receipt', render: (r) => <b>{r.receipt_no}</b> }, { title: 'Student', key: 'student_name' }, { title: 'For', key: 'description' }, { title: 'Mode', render: (r) => cap(r.method) }, { title: 'Banked', render: (r) => r.method !== 'cash' ? <span className="muted">n/a</span> : r.deposit_id ? <Badge tone="ok">Yes</Badge> : <Badge tone="warn">No</Badge> }, { title: 'Amount', render: (r) => money(r.amount), align: 'right' }]} /></Card>;
}

const FLOW = ['collected', 'handed_to_clerk', 'slip_submitted', 'verified'];
function Deposits() {
  const { user } = useAuth(); const toast = useToast(); const { data, loading, reload } = useFetch('/finance/deposits'); const [sel, setSel] = useState([]); const [notes, setNotes] = useState(''); const [slip, setSlip] = useState(null);
  const undep = data?.undeposited || []; const tot = undep.filter((u) => sel.includes(u.id)).reduce((a, b) => a + b.amount, 0);
  const adv = async (d, status, slip_ref) => { try { await api.post(`/finance/deposits/${d.id}/advance`, { status, slip_ref }); toast('Updated'); reload(); } catch (e) { toast(e.message, 'bad'); } };
  return <div className="stack">
    <Alert>Cash flow: <b>Collected → Handed to clerk → Bank slip submitted → Verified by admin</b>. Each step is logged.</Alert>
    <Card title="Cash waiting to be banked" action={<Button variant="primary" disabled={!sel.length} onClick={async () => { try { await api.post('/finance/deposits', { payment_ids: sel, notes }); setSel([]); setNotes(''); toast('Deposit batch created'); reload(); } catch (e) { toast(e.message, 'bad'); } }}>Create deposit ({money(tot)})</Button>} pad={false}>
      {!undep.length ? <Empty title="All cash is banked" icon={Landmark} /> : <><Table rows={undep} columns={[{ title: '', render: (u) => <input type="checkbox" checked={sel.includes(u.id)} onChange={(e) => setSel(e.target.checked ? [...sel, u.id] : sel.filter((x) => x !== u.id))} /> }, { title: 'Receipt', render: (u) => <b>{u.receipt_no}</b> }, { title: 'Student', key: 'student_name' }, { title: 'Date', render: (u) => fdatetime(u.paid_at) }, { title: 'Amount', render: (u) => money(u.amount), align: 'right' }]} />
        <div style={{ padding: 14 }}><div className="row"><Button size="sm" onClick={() => setSel(sel.length === undep.length ? [] : undep.map((u) => u.id))}>{sel.length === undep.length ? 'Clear' : 'Select all'}</Button><div style={{ flex: 1 }}><Input placeholder="Notes (optional)" value={notes} onChange={setNotes} /></div></div></div></>}</Card>
    <Card title="Deposit batches" pad={false}><Table loading={loading} rows={data?.rows} empty="No deposits yet" columns={[{ title: 'Deposit', render: (d) => <div><b>{d.deposit_no}</b><div className="muted small">{fdate(d.created_at)} · {d.payments} receipts</div></div> }, { title: 'Amount', render: (d) => money(d.amount), align: 'right' },
      { title: 'Progress', render: (d) => <div className="row" style={{ gap: 4 }}>{FLOW.map((s, i) => <span key={s} title={cap(s)} className={`dot-step ${FLOW.indexOf(d.status === 'rejected' ? 'slip_submitted' : d.status) >= i ? 'on' : ''}`} />)}</div> },
      { title: 'Status', render: (d) => <div><StatusBadge status={d.status} />{d.slip_ref && <div className="muted small">Slip {d.slip_ref}</div>}{d.verified_by_name && <div className="muted small">by {d.verified_by_name}</div>}</div> },
      { title: '', render: (d) => <div className="row end">{d.status === 'collected' && <Button size="sm" onClick={() => adv(d, 'handed_to_clerk')}>Handed to clerk <ChevronRight size={14} /></Button>}
        {(d.status === 'handed_to_clerk' || d.status === 'rejected') && <Button size="sm" variant="primary" onClick={() => setSlip({ d, ref: '' })}>Submit bank slip</Button>}
        {d.status === 'slip_submitted' && (user.role === 'admin' ? <><Button size="sm" variant="ok" icon={CheckCircle2} onClick={() => adv(d, 'verified')}>Verify</Button><Button size="sm" variant="danger" icon={XCircle} onClick={() => adv(d, 'rejected')}>Reject</Button></> : <span className="muted small">Awaiting admin</span>)}</div> }]} /></Card>
    {slip && <FormModal title={`Bank slip for ${slip.d.deposit_no}`} submitLabel="Submit" onClose={() => setSlip(null)} onSubmit={async () => { await api.post(`/finance/deposits/${slip.d.id}/advance`, { status: 'slip_submitted', slip_ref: slip.ref }); setSlip(null); reload(); toast('Sent to admin for verification'); }}><Input label="Bank slip / reference number *" value={slip.ref} onChange={(v) => setSlip({ ...slip, ref: v })} required /></FormModal>}</div>;
}

function Expenses() {
  const { user } = useAuth(); const toast = useToast(); const [ask, node] = useConfirm(); const [cat, setCat] = useState(''); const qs = `/finance/expenses?limit=300${cat ? `&category=${encodeURIComponent(cat)}` : ''}`;
  const { data, loading, reload } = useFetch(qs, [cat]); const [form, setForm] = useState(null);
  return <>
    <Card title="Expenses" action={<div className="row"><div style={{ width: 160 }}><Select value={cat} onChange={setCat} placeholder="All categories" options={CATS} /></div><Button icon={Download} onClick={() => api.download(`${qs}&format=csv`, 'expenses.csv')} /><Button variant="primary" icon={Plus} onClick={() => setForm({ expense_date: today(), category: 'Utilities', vendor: '', description: '', amount: '', payment_status: 'paid' })}>Add expense</Button></div>} pad={false}>
      <Table loading={loading} rows={data?.rows} empty="No expenses recorded" columns={[{ title: 'Date', render: (e) => fdate(e.expense_date) }, { title: 'Category', render: (e) => <Badge>{e.category}</Badge> }, { title: 'Details', render: (e) => <div><b>{e.vendor || '-'}</b><div className="muted small">{e.description}</div></div> }, { title: 'Status', render: (e) => <StatusBadge status={e.payment_status} /> }, { title: 'Amount', render: (e) => money(e.amount), align: 'right' },
        { title: '', render: (e) => <div className="row end"><Button size="sm" icon={Pencil} onClick={() => setForm(e)} />{user.role === 'admin' && <Button size="sm" variant="danger" icon={Trash2} onClick={async () => { if (await ask({ message: 'Delete this expense?', danger: true, confirm: 'Delete' })) { await api.del(`/finance/expenses/${e.id}`); reload(); } }} />}</div> }]} />
      {data && <div className="row between" style={{ padding: 14 }}><span className="muted">Total of the list above</span><b>{money(data.total)}</b></div>}</Card>
    {form && <FormModal title={form.id ? 'Edit expense' : 'Add expense'} onClose={() => setForm(null)} onSubmit={async () => { const r = form.id ? await api.put(`/finance/expenses/${form.id}`, form) : await api.post('/finance/expenses', form); setForm(null); reload(); toast(r?.warning || 'Saved', r?.warning ? 'warn' : undefined); }}>
      <div className="form-grid"><Input label="Date" type="date" value={form.expense_date} onChange={(v) => setForm({ ...form, expense_date: v })} /><Select label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATS} /><Input label="Vendor" value={form.vendor || ''} onChange={(v) => setForm({ ...form, vendor: v })} /><Input label="Amount *" type="number" min="0" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
        <Input full label="Description" value={form.description || ''} onChange={(v) => setForm({ ...form, description: v })} /><Select label="Payment" value={form.payment_status} onChange={(v) => setForm({ ...form, payment_status: v })} options={['paid', 'pending']} /></div></FormModal>}
    {node}</>;
}

function Budgets() {
  const { user } = useAuth(); const toast = useToast(); const { data, loading, reload } = useFetch('/finance/budgets'); const [form, setForm] = useState(null);
  return <>
    <Card title={`Budget vs actual${data ? ` · FY ${data.fiscal_year}` : ''}`} action={<Button variant="primary" icon={Plus} onClick={() => setForm({ category: CATS[0], amount: '' })}>Set budget</Button>}>
      {loading ? <div className="skeleton" style={{ height: 120 }} /> : !data?.rows.length ? <Empty title="No budgets set" icon={Banknote}>Set a yearly budget per category. You will be alerted if spending crosses it.</Empty> : <div className="stack">
        <div className="grid g3"><Stat label="Total budget" value={money(data.totals.budget)} /><Stat label="Spent" value={money(data.totals.spent)} /><Stat tone={data.totals.spent > data.totals.budget ? 'bad' : 'ok'} label="Remaining" value={money(data.totals.budget - data.totals.spent)} /></div>
        {data.rows.map((b) => <div key={b.id}><div className="row between"><b>{b.category}</b><span className="small">{money(b.spent)} of {money(b.budget)} {b.used_percent > 100 && <Badge tone="bad">Over budget</Badge>}</span></div><Progress value={b.used_percent} tone={b.used_percent > 100 ? 'bad' : b.used_percent > 85 ? 'warn' : 'ok'} />{user.role === 'admin' && <div style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={async () => { await api.del(`/finance/budgets/${b.id}`); reload(); }}>Remove</button></div>}</div>)}</div>}</Card>
    {form && <FormModal title="Set yearly budget" onClose={() => setForm(null)} onSubmit={async () => { await api.post('/finance/budgets', form); setForm(null); reload(); toast('Budget saved'); }}><div className="form-grid"><Select label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATS} /><Input label="Yearly amount *" type="number" min="0" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required /></div></FormModal>}</>;
}

export default function Finance() {
  const [tab, setTab] = useState('overview');
  return <><PageHead title="Finance" sub="Cash book, bank deposit verification, expenses and budgets" /><div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'cashbook', label: 'Cash book' }, { id: 'deposits', label: 'Bank deposits' }, { id: 'expenses', label: 'Expenses' }, { id: 'budgets', label: 'Budgets' }]} /></div>
    {tab === 'overview' && <Overview />}{tab === 'cashbook' && <CashBook />}{tab === 'deposits' && <Deposits />}{tab === 'expenses' && <Expenses />}{tab === 'budgets' && <Budgets />}</>;
}

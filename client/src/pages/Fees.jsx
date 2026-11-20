import { useMemo, useState } from 'react';
import { Plus, Wand2, Printer, CreditCard, Download, Tag, Percent, Ban, Pencil, Trash2, Smartphone, Landmark, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Alert, Badge, Button, Card, Empty, ErrorBox, FormModal, Input, Loading, Modal, PageHead, Progress, Select, SearchBox, Stat, StatusBadge, Table, Tabs, useConfirm, useToast } from '../components/ui.jsx';
import { fdate, fdatetime, money, today, addDays } from '../lib/format.js';

export function Receipt({ id, onClose }) {
  const { data, loading } = useFetch(`/fees/receipt/${id}`);
  return (
    <Modal title="Payment receipt" onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={Printer} onClick={() => window.print()}>Print</Button></>}>
      {loading ? <Loading rows={2} /> : data && <div className="print-area" style={{ padding: 8 }}>
        <div className="center"><h3>{data.school.school_name}</h3><div className="muted small">{data.school.school_address}</div><div className="badge b-ok" style={{ marginTop: 10 }}><CheckCircle2 size={14} /> PAID</div></div>
        <hr className="sep" />
        <dl className="kv"><dt>Receipt no.</dt><dd><b>{data.payment.receipt_no}</b></dd><dt>Date</dt><dd>{fdatetime(data.payment.paid_at)}</dd><dt>Student</dt><dd>{data.student.name} ({data.student.admission_no})</dd><dt>Class</dt><dd>{data.student.class_label || '-'}</dd>
          <dt>Invoice</dt><dd>{data.payment.invoice_no} · {data.payment.description}</dd><dt>Payment mode</dt><dd style={{ textTransform: 'capitalize' }}>{data.payment.method}{data.payment.reference ? ` · Ref ${data.payment.reference}` : ''}</dd>
          {data.payment.status === 'refunded' && <><dt>Status</dt><dd><Badge tone="bad">Refunded</Badge></dd></>}</dl>
        <hr className="sep" /><div className="row between"><span>Amount paid</span><b style={{ fontSize: 24 }}>{money(data.payment.amount)}</b></div>
        <div className="row between muted small"><span>Balance on this invoice</span><span>{money(data.balance.balance)}</span></div>
      </div>}
    </Modal>
  );
}

/* ---------------- parent online payment ---------------- */
function PayModal({ inv, onClose, onDone }) {
  const [amount, setAmount] = useState(inv.balance); const [method, setMethod] = useState('upi'); const [step, setStep] = useState('choose'); const [err, setErr] = useState(''); const [order, setOrder] = useState(null);
  const start = async () => { setErr(''); try { const o = await api.post('/fees/portal/order', { invoice_id: inv.invoice_id, amount: Number(amount) }); setOrder(o); setStep('pay'); } catch (e) { setErr(e.message); } };
  const confirm = async (outcome) => { setStep('processing'); setErr(''); try { const r = await api.post('/fees/portal/confirm', { order_ref: order.order_ref, method, outcome }); setStep('done'); setOrder({ ...order, payment: r.payment }); } catch (e) { setErr(e.message); setStep('pay'); } };
  const M = [['upi', Smartphone, 'UPI'], ['card', CreditCard, 'Card'], ['netbanking', Landmark, 'Net banking']];
  return (
    <Modal title={step === 'done' ? 'Payment successful' : `Pay ${inv.description}`} size="narrow" onClose={step === 'processing' ? undefined : (step === 'done' ? onDone : onClose)}
      footer={step === 'choose' ? <><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={start} disabled={!(Number(amount) > 0)}>Continue to pay {money(amount)}</Button></> : step === 'done' ? <Button variant="primary" onClick={onDone}>Done</Button> : null}>
      {err && <Alert tone="bad">{err}</Alert>}
      {step === 'choose' && <div className="stack"><div className="card card-pad"><div className="row between"><span className="muted">{inv.invoice_no}</span><b>Balance {money(inv.balance)}</b></div></div>
        <Input label="Amount to pay" type="number" min="1" max={inv.balance} value={amount} onChange={setAmount} hint="You can pay part of the balance now and the rest later." />
        <div className="field"><label>Payment method</label><div className="row">{M.map(([k, I, l]) => <button key={k} type="button" className={`chip ${method === k ? 'on' : ''}`} onClick={() => setMethod(k)}><I size={15} /> {l}</button>)}</div></div></div>}
      {step === 'pay' && order && <div className="stack"><Alert><ShieldCheck />This is the built-in <b>demo gateway</b>. No real money moves. Connect Razorpay/Stripe in <code>server/src/utils/gateway.js</code> for live payments.</Alert>
        <div className="card card-pad center"><div className="muted small">Order {order.order_ref}</div><div style={{ fontSize: 32, fontWeight: 800 }}>{money(order.amount)}</div></div>
        <Button variant="ok" onClick={() => confirm('success')}>Approve payment</Button><Button variant="danger" onClick={() => confirm('fail')}>Simulate declined payment</Button></div>}
      {step === 'processing' && <div className="center" style={{ padding: 30 }}><span className="spinner" /><p>Confirming with the bank…</p></div>}
      {step === 'done' && order?.payment && <div className="center stack"><CheckCircle2 size={56} color="var(--ok)" style={{ margin: '0 auto' }} /><h3>{money(order.payment.amount)} received</h3><div className="muted">Receipt {order.payment.receipt_no}</div></div>}
    </Modal>
  );
}

function Family() {
  const { user } = useAuth(); const { child } = useChild(); const canPay = user.role === 'parent'; const [tab, setTab] = useState('due'); const [pay, setPay] = useState(null); const [rcpt, setRcpt] = useState(null);
  const inv = useFetch(child ? `/fees/invoices?student_id=${child.id}&limit=200` : null); const structs = useFetch(child ? '/fees/structures' : null); const pays = useFetch(child && tab === 'receipts' ? `/fees/payments?student_id=${child.id}` : null);
  const [range, setRange] = useState('3m'); const from = range === 'all' ? 'all' : addDays(today(), range === '3m' ? -92 : -365);
  const ledger = useFetch(child && tab === 'ledger' ? `/fees/ledger/${child.id}?from=${from}` : null);
  if (!child) return <Empty title="No child selected" />;
  const rows = inv.data?.rows || []; const due = rows.filter((r) => ['unpaid', 'partial'].includes(r.status)); const totalDue = due.reduce((a, b) => a + b.balance, 0);
  return (
    <>
      <PageHead title={canPay ? 'Fees & payments' : 'Fees'} sub={`${child.name} · ${child.class_label || ''}`} />
      <div className="grid g3"><Stat hero label="Total due" value={money(totalDue)} sub={`${due.length} open invoice(s)`} /><Stat tone="bad" label="Overdue" value={money(due.filter((d) => d.overdue).reduce((a, b) => a + b.balance, 0))} /><Stat tone="ok" label="Paid so far" value={money(rows.reduce((a, b) => a + b.paid, 0))} /></div>
      <div style={{ margin: '18px 0' }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'due', label: 'Invoices' }, { id: 'structure', label: 'Fee structure' }, { id: 'ledger', label: 'Ledger' }, { id: 'receipts', label: 'Receipts' }]} /></div>
      <ErrorBox error={inv.error} />
      {tab === 'due' && <Card pad={false}><Table loading={inv.loading} rows={rows} rowKey="invoice_id" empty="No invoices yet" columns={[{ title: 'Invoice', render: (r) => <div><b>{r.description}</b><div className="muted small">{r.invoice_no}</div></div> }, { title: 'Due date', render: (r) => <div>{fdate(r.due_date)}{r.overdue ? <div><Badge tone="bad">Overdue</Badge></div> : null}</div> },
        { title: 'Amount', render: (r) => <div>{money(r.total)}{r.late_fee > 0 && <div className="muted small">incl. late fee {money(r.late_fee)}</div>}{r.discount > 0 && <div className="muted small">after concession {money(r.discount)}</div>}</div>, align: 'right' },
        { title: 'Paid', render: (r) => money(r.paid), align: 'right' }, { title: 'Balance', render: (r) => <b>{money(r.balance)}</b>, align: 'right' }, { title: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { title: '', render: (r) => canPay && r.balance > 0 && r.status !== 'cancelled' ? <Button size="sm" variant="primary" icon={CreditCard} onClick={() => setPay(r)}>Pay now</Button> : null }]} /></Card>}
      {tab === 'structure' && <Card title="Fee structure for this class" pad={false}><Table loading={structs.loading} rows={structs.data?.rows} empty="No fee structure published" columns={[{ title: 'Fee head', render: (r) => <b>{r.name}</b> }, { title: 'Term', render: (r) => r.term || '-' }, { title: 'Amount', render: (r) => money(r.amount), align: 'right' }, { title: 'Due date', render: (r) => fdate(r.due_date) }]} /></Card>}
      {tab === 'ledger' && <Card title="Student ledger" action={<div style={{ width: 170 }}><Select value={range} onChange={setRange} options={[{ value: '3m', label: 'Last 3 months' }, { value: '12m', label: 'Last 12 months' }, { value: 'all', label: 'Everything' }]} /></div>}>
        {ledger.loading ? <Loading /> : ledger.data && <><div className="row between" style={{ marginBottom: 10 }}><span className="muted">Opening balance</span><b>{money(ledger.data.opening_balance)}</b></div>
          <Table rows={ledger.data.entries.map((e, i) => ({ ...e, id: i }))} empty="No transactions in this period" columns={[{ title: 'Date', render: (e) => fdate(e.entry_date) }, { title: 'Particulars', render: (e) => <div>{e.particulars}<div className="muted small">{e.ref}</div></div> }, { title: 'Debit', render: (e) => (e.debit ? money(e.debit) : ''), align: 'right' }, { title: 'Credit', render: (e) => (e.credit ? money(e.credit) : ''), align: 'right' }, { title: 'Balance', render: (e) => money(e.balance), align: 'right' }]} />
          <div className="row between" style={{ marginTop: 12 }}><span className="muted">Closing balance (amount owed)</span><b style={{ fontSize: 18 }}>{money(ledger.data.closing_balance)}</b></div></>}</Card>}
      {tab === 'receipts' && <Card pad={false}><Table loading={pays.loading} rows={pays.data?.rows} empty="No payments yet" columns={[{ title: 'Receipt', render: (p) => <b>{p.receipt_no}</b> }, { title: 'Date', render: (p) => fdatetime(p.paid_at) }, { title: 'For', key: 'description' }, { title: 'Mode', render: (p) => <span style={{ textTransform: 'capitalize' }}>{p.method}</span> }, { title: 'Amount', render: (p) => money(p.amount), align: 'right' }, { title: 'Status', render: (p) => <StatusBadge status={p.status} /> }, { title: '', render: (p) => <Button size="sm" onClick={() => setRcpt(p.id)}>View</Button> }]} /></Card>}
      {pay && <PayModal inv={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); inv.reload(); }} />}
      {rcpt && <Receipt id={rcpt} onClose={() => setRcpt(null)} />}
    </>
  );
}

/* ---------------- admin / finance ---------------- */
function StructForm({ s, classes, onClose, onDone }) {
  const [f, setF] = useState({ class_id: s?.class_id || classes[0]?.id || '', name: s?.name || '', term: s?.term || '', amount: s?.amount || '', due_date: s?.due_date || '', late_fee_percent: s?.late_fee_percent ?? '' }); const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return <FormModal title={s ? 'Edit fee' : 'New fee head'} onClose={onClose} onSubmit={async () => { s ? await api.put(`/fees/structures/${s.id}`, f) : await api.post('/fees/structures', f); onDone(); }}>
    <div className="form-grid"><Select label="Class *" value={f.class_id} onChange={set('class_id')} options={classes.map((c) => ({ value: c.id, label: c.label }))} /><Input label="Fee head *" value={f.name} onChange={set('name')} placeholder="Tuition Fee" required />
      <Input label="Term" value={f.term} onChange={set('term')} placeholder="Term 1" /><Input label="Amount *" type="number" min="0" value={f.amount} onChange={set('amount')} required /><Input label="Due date *" type="date" value={f.due_date} onChange={set('due_date')} required /><Input label="Late fee % (optional)" type="number" min="0" max="100" value={f.late_fee_percent} onChange={set('late_fee_percent')} hint="Blank = school default" /></div></FormModal>;
}

function Collect({ inv, onClose, onDone }) {
  const [f, setF] = useState({ amount: inv.balance, method: 'cash', reference: '' }); const set = (k) => (v) => setF((x) => ({ ...x, [k]: v })); const key = useMemo(() => `ctr-${inv.invoice_id}-${Date.now()}`, [inv.invoice_id]);
  return <FormModal title={`Collect fee: ${inv.student_name}`} submitLabel="Record payment" onClose={onClose} onSubmit={async () => { const r = await api.post('/fees/pay', { invoice_id: inv.invoice_id, ...f, idempotency_key: key }); onDone(r.payment); }}>
    <div className="card card-pad"><div className="row between"><div><b>{inv.description}</b><div className="muted small">{inv.invoice_no} · due {fdate(inv.due_date)}</div></div><div className="right"><div className="muted small">Balance</div><b style={{ fontSize: 20 }}>{money(inv.balance)}</b></div></div></div>
    <div className="form-grid"><Input label="Amount *" type="number" min="1" max={inv.balance} value={f.amount} onChange={set('amount')} required /><Select label="Mode" value={f.method} onChange={set('method')} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'netbanking', label: 'Net banking' }, { value: 'cheque', label: 'Cheque' }]} />
      <Input full label="Reference (txn id / cheque no.)" value={f.reference} onChange={set('reference')} /></div>
    <p className="hint" style={{ margin: 0 }}>Submitting twice is safe. Duplicate clicks create a single receipt.</p></FormModal>;
}

function Staff() {
  const { user } = useAuth(); const toast = useToast(); const [ask, node] = useConfirm(); const [tab, setTab] = useState('invoices'); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [cls, setCls] = useState('');
  const classes = useFetch('/classes'); const structs = useFetch('/fees/structures');
  const qs = `/fees/invoices?limit=300${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}${cls ? `&class_id=${cls}` : ''}`; const inv = useFetch(qs);
  const [form, setForm] = useState(null); const [col, setCol] = useState(null); const [rcpt, setRcpt] = useState(null); const [manual, setManual] = useState(null); const [disc, setDisc] = useState(null);
  const students = useFetch(manual ? '/students?limit=500' : null);
  const admin = user.role === 'admin'; const C = classes.data?.rows || [];
  const gen = async (s) => { if (!(await ask({ title: 'Generate invoices', message: `Create "${s.name}${s.term ? ` (${s.term})` : ''}" invoices for every active student in Class ${s.class_label}? Students who already have one are skipped and parents are notified.`, confirm: 'Generate' }))) return; try { const r = await api.post(`/fees/structures/${s.id}/generate`); toast(`${r.created} invoice(s) created, ${r.skipped} already existed`); structs.reload(); inv.reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title="Fees & invoices" sub="Define fee structures, generate invoices, collect payments and manage concessions">
        <Button icon={Download} onClick={() => api.download(`${qs}&format=csv`, 'invoices.csv').catch((e) => toast(e.message, 'bad'))}>Export</Button><Button icon={Plus} onClick={() => setManual({ student_id: '', description: '', amount: '', discount: 0, due_date: addDays(today(), 14) })}>Single invoice</Button><Button variant="primary" icon={Plus} onClick={() => setForm({})}>Fee head</Button>
      </PageHead>
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: 'invoices', label: 'Invoices & collection' }, { id: 'structure', label: 'Fee structure' }]} /></div>
      {tab === 'invoices' && <Card pad={false}>
        <div className="row" style={{ padding: 16 }}><div style={{ flex: '1 1 240px' }}><SearchBox value={q} onChange={setQ} placeholder="Student, admission no, invoice no, mobile…" /></div><div style={{ width: 160 }}><Select value={cls} onChange={setCls} placeholder="All classes" options={C.map((c) => ({ value: c.id, label: c.label }))} /></div><div style={{ width: 150 }}><Select value={status} onChange={setStatus} placeholder="Any status" options={['unpaid', 'partial', 'paid', 'overdue', 'cancelled']} /></div></div>
        <Table loading={inv.loading} rows={inv.data?.rows} rowKey="invoice_id" empty="No invoices found" columns={[
          { title: 'Student', render: (r) => <div><b>{r.student_name}</b><div className="muted small">{r.admission_no} · {r.class_label}</div></div> }, { title: 'Invoice', render: (r) => <div>{r.description}<div className="muted small">{r.invoice_no} · due {fdate(r.due_date)} {r.overdue ? <Badge tone="bad">Overdue</Badge> : null}</div></div> },
          { title: 'Total', render: (r) => <div>{money(r.total)}{r.late_fee > 0 && <div className="muted small">late fee {money(r.late_fee)}</div>}</div>, align: 'right' }, { title: 'Balance', render: (r) => <b>{money(r.balance)}</b>, align: 'right' }, { title: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { title: '', render: (r) => <div className="row end">{r.balance > 0 && r.status !== 'cancelled' && <Button size="sm" variant="primary" icon={CreditCard} onClick={() => setCol(r)}>Collect</Button>}<Button size="sm" icon={Tag} title="Scholarship / concession" onClick={() => setDisc(r)} />{admin && r.late_fee > 0 && <Button size="sm" icon={Percent} title="Waive late fee" onClick={async () => { if (await ask({ message: `Cancel the late fee of ${money(r.late_fee)} on ${r.invoice_no}? Only administrators can do this.`, confirm: 'Waive late fee' })) { await api.post(`/fees/invoices/${r.invoice_id}/waive-late-fee`); toast('Late fee waived'); inv.reload(); } }}>Waive</Button>}</div> }]} /></Card>}
      {tab === 'structure' && <Card pad={false}><Table loading={structs.loading} rows={structs.data?.rows} empty="No fee heads yet. Add the first one." columns={[{ title: 'Class', key: 'class_label' }, { title: 'Fee head', render: (s) => <div><b>{s.name}</b><div className="muted small">{s.term}</div></div> }, { title: 'Amount', render: (s) => money(s.amount), align: 'right' }, { title: 'Due', render: (s) => fdate(s.due_date) }, { title: 'Late fee', render: (s) => (s.late_fee_percent != null ? `${s.late_fee_percent}%` : 'Default') }, { title: 'Invoices', key: 'invoices', align: 'right' },
        { title: '', render: (s) => <div className="row end"><Button size="sm" variant="primary" icon={Wand2} onClick={() => gen(s)}>Generate invoices</Button><Button size="sm" icon={Pencil} onClick={() => setForm(s)} /><Button size="sm" variant="danger" icon={Trash2} onClick={async () => { try { if (await ask({ message: 'Delete this fee head?', danger: true, confirm: 'Delete' })) { await api.del(`/fees/structures/${s.id}`); structs.reload(); } } catch (e) { toast(e.message, 'bad'); } }} /></div> }]} /></Card>}
      {form && <StructForm s={form.id ? form : null} classes={C} onClose={() => setForm(null)} onDone={() => { setForm(null); structs.reload(); toast('Saved'); }} />}
      {col && <Collect inv={col} onClose={() => setCol(null)} onDone={(p) => { setCol(null); inv.reload(); toast(`Receipt ${p.receipt_no} issued`); setRcpt(p.id); }} />}
      {rcpt && <Receipt id={rcpt} onClose={() => setRcpt(null)} />}
      {manual && <FormModal title="Create a single invoice" onClose={() => setManual(null)} onSubmit={async () => { await api.post('/fees/invoices', manual); setManual(null); inv.reload(); toast('Invoice created'); }}>
        <div className="form-grid"><Select full label="Student *" value={manual.student_id} onChange={(v) => setManual({ ...manual, student_id: v })} placeholder="Choose student" options={(students.data?.rows || []).map((s) => ({ value: s.id, label: `${s.name} (${s.class_label || '-'})` }))} /><Input full label="Description *" value={manual.description} onChange={(v) => setManual({ ...manual, description: v })} placeholder="Bus fee, Exam fee, Fine…" /><Input label="Amount *" type="number" value={manual.amount} onChange={(v) => setManual({ ...manual, amount: v })} /><Input label="Discount" type="number" value={manual.discount} onChange={(v) => setManual({ ...manual, discount: v })} /><Input label="Due date *" type="date" value={manual.due_date} onChange={(v) => setManual({ ...manual, due_date: v })} /></div></FormModal>}
      {disc && <FormModal title={`Concession: ${disc.invoice_no}`} onClose={() => setDisc(null)} onSubmit={async () => { await api.put(`/fees/invoices/${disc.invoice_id}/discount`, { discount: disc.newDiscount ?? disc.discount, note: disc.note }); setDisc(null); inv.reload(); toast('Concession applied'); }}>
        <Alert>Invoice amount {money(disc.amount)}. Enter the total scholarship / discount to apply.</Alert><Input label="Discount amount" type="number" min="0" max={disc.amount} value={disc.newDiscount ?? disc.discount} onChange={(v) => setDisc({ ...disc, newDiscount: v })} /><Input label="Reason (kept in audit trail)" value={disc.note || ''} onChange={(v) => setDisc({ ...disc, note: v })} placeholder="Merit scholarship, sibling discount…" /></FormModal>}
      {node}
    </>
  );
}

export default function Fees() { const { user } = useAuth(); return user.role === 'admin' || user.role === 'finance' ? <Staff /> : <Family />; }

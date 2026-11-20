import { useNavigate, Link } from 'react-router-dom';
import { Users, GraduationCap, Wallet, TrendingUp, AlertTriangle, CalendarCheck, Bus, UserCheck, LifeBuoy, CalendarOff, Landmark, Clock, BookOpen, Bell, IdCard, Receipt, Briefcase, MessageSquareWarning, PartyPopper, Banknote } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { useFetch } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Alert, Badge, Card, Empty, ErrorBox, Loading, PageHead, Progress, Stat } from '../components/ui.jsx';
import { BarChart, Donut, HBars, LineChart, monthData } from '../components/charts.jsx';
import { compact, fdate, money, monthLabel, cap } from '../lib/format.js';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function Upcoming({ rows }) {
  return (
    <Card title="Upcoming events & holidays" action={<Link to="/notices" className="small">Calendar</Link>}>
      {!rows?.length ? <Empty title="No upcoming events" icon={PartyPopper} /> : <div className="list">{rows.map((e) => (
        <div className="list-item" key={e.id}><Badge tone={e.kind === 'holiday' ? 'bad' : 'info'}>{cap(e.kind)}</Badge><div className="grow"><b>{e.title}</b></div><span className="muted small">{fdate(e.start_date)}{e.end_date && e.end_date !== e.start_date ? ` - ${fdate(e.end_date)}` : ''}</span></div>))}</div>}
    </Card>
  );
}

function Admin({ d }) {
  const nav = useNavigate(); const att = d.today_attendance; const tot = att.present + att.absent + att.on_leave;
  const p = d.pending; const needs = p.approvals + p.leaves + p.staff_leaves + p.change_requests + p.deposits;
  return (
    <>
      <div className="grid g4">
        <Stat hero icon={GraduationCap} label="Active students" value={d.counts.students} sub={`${d.counts.inactive_students} inactive · ${d.counts.classes} classes`} onClick={() => nav('/students')} />
        <Stat icon={Wallet} tone="ok" label="Collected this month" value={money(d.finance.collected_month)} sub={`Expenses ${money(d.finance.expenses_month)}`} onClick={() => nav('/finance')} />
        <Stat icon={AlertTriangle} tone="bad" label="Outstanding fees" value={money(d.finance.outstanding)} sub={`${money(d.finance.overdue)} overdue`} onClick={() => nav('/fees')} />
        <Stat icon={Bus} tone="info" label="Buses on the road" value={d.buses_running} sub={`${d.counts.drivers} drivers`} onClick={() => nav('/transport')} />
      </div>
      {needs > 0 && <div style={{ marginTop: 16 }}><Card title="Needs your attention"><div className="row">
        {p.approvals > 0 && <Link className="chip" to="/approvals"><UserCheck size={15} /> {p.approvals} account approval{p.approvals > 1 ? 's' : ''}</Link>}
        {p.leaves > 0 && <Link className="chip" to="/leaves"><CalendarOff size={15} /> {p.leaves} student leave</Link>}
        {p.staff_leaves > 0 && <Link className="chip" to="/hr"><Briefcase size={15} /> {p.staff_leaves} staff leave</Link>}
        {p.change_requests > 0 && <Link className="chip" to="/requests"><MessageSquareWarning size={15} /> {p.change_requests} name/DOB change</Link>}
        {p.deposits > 0 && <Link className="chip" to="/finance"><Landmark size={15} /> {p.deposits} bank slip to verify</Link>}
        {p.open_tickets > 0 && <Link className="chip" to="/tickets"><LifeBuoy size={15} /> {p.open_tickets} open ticket{p.open_tickets > 1 ? 's' : ''}</Link>}
      </div></Card></div>}
      <div className="grid g-main" style={{ marginTop: 16 }}>
        <Card title="Fee collection vs. outstanding (6 months)"><BarChart data={monthData(d.collection_series)} series={[{ key: 'collected', name: 'Collected', color: '#10b981' }, { key: 'outstanding', name: 'Outstanding (by due month)', color: '#f59e0b' }]} /></Card>
        <Card title="Today's attendance" action={<Link to="/attendance" className="small">Details</Link>}>
          {tot ? <Donut data={[{ label: 'Present', value: att.present, color: '#10b981' }, { label: 'Absent', value: att.absent, color: '#ef4444' }, { label: 'On leave', value: att.on_leave, color: '#f59e0b' }]} /> : <Empty title="Not marked yet" icon={CalendarCheck} />}
          {d.classes_unmarked.length > 0 && <Alert tone="warn">Pending: {d.classes_unmarked.join(', ')}</Alert>}
        </Card>
      </div>
      <div className="grid g3" style={{ marginTop: 16 }}>
        <Card title="Attendance trend (7 days)"><LineChart data={d.attendance_trend.map((x) => ({ label: x.date.slice(5), value: x.percent }))} min={50} /></Card>
        <Card title="Class strength"><HBars data={d.class_strength} /></Card>
        <Upcoming rows={d.upcoming} />
      </div>
    </>
  );
}

function Finance({ d }) {
  const nav = useNavigate();
  return (
    <>
      <div className="grid g4">
        <Stat hero icon={Banknote} label="Collected today" value={money(d.collected_today)} sub={`This month ${money(d.collected_month)}`} />
        <Stat icon={AlertTriangle} tone="bad" label="Outstanding" value={money(d.outstanding)} sub={`${d.overdue_students} students overdue`} onClick={() => nav('/fees')} />
        <Stat icon={Landmark} tone="warn" label="Cash not yet banked" value={money(d.undeposited_cash)} sub={`${d.pending_deposits} deposit(s) in progress`} onClick={() => nav('/finance')} />
        <Stat icon={TrendingUp} tone="info" label="Expenses this month" value={money(d.expenses_month)} onClick={() => nav('/finance')} />
      </div>
      <div className="grid g-main" style={{ marginTop: 16 }}>
        <Card title="Collections vs expenses"><BarChart data={monthData(d.series)} series={[{ key: 'collected', name: 'Collected', color: '#10b981' }, { key: 'expenses', name: 'Expenses', color: '#ef4444' }]} /></Card>
        <Card title="Latest receipts">{d.recent_payments.length === 0 ? <Empty title="No payments yet" /> : <div className="list">{d.recent_payments.map((p) => <div className="list-item" key={p.receipt_no}><div className="grow"><b>{p.student}</b><div className="muted small">{p.receipt_no} · {p.method}</div></div><b className="mono">{money(p.amount)}</b></div>)}</div>}</Card>
      </div>
    </>
  );
}

function Teacher({ d }) {
  const nav = useNavigate(); const p = d.pending;
  return (
    <>
      <div className="grid g4">
        <Stat hero icon={Users} label="My classes" value={d.classes.length} sub={d.classes.filter((c) => c.is_ct).map((c) => `CT of ${c.label}`).join(', ') || 'Subject teacher'} />
        <Stat icon={CalendarOff} tone="warn" label="Leave requests" value={p.leaves} sub="Waiting for you" onClick={() => nav('/leaves')} />
        <Stat icon={MessageSquareWarning} tone="info" label="Change requests" value={p.change_requests} onClick={() => nav('/requests')} />
        <Stat icon={LifeBuoy} tone="bad" label="Open support tickets" value={p.tickets} onClick={() => nav('/tickets')} />
      </div>
      <div className="grid g-main" style={{ marginTop: 16 }}>
        <div className="stack">
          <Card title="My classes today">
            <div className="list">{d.classes.map((c) => (
              <div className="list-item" key={c.id}><div className="avatar sm">{c.label}</div><div className="grow"><b>Class {c.label}</b> {c.is_ct && <Badge>Class teacher</Badge>}<div className="muted small">{c.students} students</div></div>
                {c.is_ct && (c.attendance_marked ? <Badge tone="ok">Attendance done</Badge> : <button className="btn btn-sm btn-primary" onClick={() => nav('/attendance')}>Mark attendance</button>)}</div>))}</div>
            {!d.classes.length && <Empty title="No classes assigned yet" />}
          </Card>
          <Card title="Absent today (my class)">{d.absent_today.length ? <div className="row">{d.absent_today.map((s) => <Link key={s.id} to={`/students/${s.id}`} className="chip">{s.name}</Link>)}</div> : <span className="muted">No absentees recorded.</span>}</Card>
        </div>
        <div className="stack">
          <Card title="Today's timetable">{d.today_timetable.length ? <div className="list">{d.today_timetable.map((t, i) => <div className="list-item" key={i}><Badge>{t.period}</Badge><div className="grow"><b>{t.subject}</b><div className="muted small">Class {t.class_label}</div></div><span className="muted small">{t.start_time}-{t.end_time}</span></div>)}</div> : <Empty title="No periods today" icon={Clock} />}</Card>
          <Upcoming rows={d.upcoming} />
        </div>
      </div>
    </>
  );
}

function Family({ d }) {
  const { child } = useChild(); const nav = useNavigate();
  const c = d.children.find((x) => x.id === child?.id) || d.children[0];
  if (!c) return <Empty title="No child linked to your account yet">Ask the school office to link your child, or check that your account is approved.</Empty>;
  return (
    <>
      {c.status === 'inactive' && <Alert tone="bad">This student record is currently inactive. Please contact the class teacher or school office.</Alert>}
      <div className="grid g4" style={{ marginTop: c.status === 'inactive' ? 16 : 0 }}>
        <Stat hero icon={GraduationCap} label={c.name} value={c.class_label || '-'} sub={`Admission no. ${c.admission_no}`} onClick={() => nav('/students')} />
        <Stat icon={CalendarCheck} tone={c.attendance_percent == null ? '' : c.attendance_percent >= 85 ? 'ok' : 'warn'} label="Attendance (3 months)" value={c.attendance_percent == null ? '-' : `${c.attendance_percent}%`} sub={c.attendance_percent != null && c.attendance_percent < 75 ? 'Below the 75% requirement' : 'Keep it up'} onClick={() => nav('/attendance')} />
        <Stat icon={Wallet} tone={c.fees_due > 0 ? (c.overdue_invoices ? 'bad' : 'warn') : 'ok'} label="Fees due" value={money(c.fees_due)} sub={c.fees_due > 0 ? `Next due ${fdate(c.next_due)}${c.overdue_invoices ? ' · overdue' : ''}` : 'All paid. Thank you!'} onClick={() => nav('/fees')} />
        <Stat icon={TrendingUp} tone="info" label={c.last_exam ? c.last_exam.name : 'Latest result'} value={c.last_exam ? `${c.last_exam.percent}%` : '-'} sub={c.last_exam ? 'Overall score' : 'No results published yet'} onClick={() => nav('/exams')} />
      </div>
      <div className="grid g-main" style={{ marginTop: 16 }}>
        <div className="stack">
          {c.fees_due > 0 && <Alert tone={c.overdue_invoices ? 'bad' : 'warn'}><b>{money(c.fees_due)}</b> is pending across {c.invoices_due} invoice(s). <Link to="/fees">Pay online now</Link></Alert>}
          {c.bus_route && <Card title="School bus" action={<Link to="/bus" className="small">Track</Link>}><div className="row between"><div><b>{c.bus_route}</b><div className="muted small">{c.bus_running ? 'The bus is on the road right now' : 'Not running at the moment'}</div></div><Badge tone={c.bus_running ? 'ok' : 'gray'}>{c.bus_running ? 'Live' : 'Idle'}</Badge></div></Card>}
          <Card title="Class diary" action={<Link to="/diary" className="small">All entries</Link>}>
            {c.diary.length ? <div className="list">{c.diary.map((x, i) => <div className="list-item" key={i}><BookOpen size={18} color="var(--brand)" /><div className="grow"><b>{x.title}</b><div className="muted small">{x.subject || 'General'} · {fdate(x.date)}</div></div>{x.homework_due && <Badge tone="warn">Due {fdate(x.homework_due)}</Badge>}</div>)}</div> : <Empty title="No diary entries" icon={BookOpen} />}
          </Card>
          <Card title="Notices" action={<Link to="/notices" className="small">View all</Link>}>
            {d.notices.length ? <div className="list">{d.notices.map((n) => <div className="list-item" key={n.id}><Bell size={16} color="var(--brand)" /><div className="grow"><b>{n.title}</b></div><span className="muted small">{fdate(n.start_date)}</span></div>)}</div> : <span className="muted">No notices.</span>}
          </Card>
        </div>
        <Upcoming rows={d.upcoming} />
      </div>
    </>
  );
}

function Driver({ d }) {
  const nav = useNavigate();
  return (
    <>
      {!d.vehicle && <Alert tone="warn">No vehicle has been assigned to you yet. Please contact the school admin.</Alert>}
      <div className="grid g4" style={{ marginTop: d.vehicle ? 0 : 16 }}>
        <Stat hero icon={Bus} label="My vehicle" value={d.vehicle?.reg_no || '-'} sub={d.vehicle?.model} onClick={() => nav('/drive')} />
        <Stat icon={Users} tone="info" label="Students on my route" value={d.riders} sub={d.route?.name} />
        <Stat icon={Clock} tone={d.trip ? 'ok' : ''} label="Trip status" value={d.trip ? 'Running' : 'Idle'} sub={d.trip ? `${cap(d.trip.kind)} started` : 'Open the trip console to start'} onClick={() => nav('/drive')} />
        <Stat icon={IdCard} tone={d.employee?.license_expiry && d.employee.license_expiry < new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? 'bad' : 'ok'} label="Licence valid until" value={fdate(d.employee?.license_expiry)} sub={d.employee?.license_no} />
      </div>
      <div style={{ marginTop: 16 }}><Card title="Latest payslip">{d.latest_payslip ? <div className="row between"><div><b>{monthLabel(d.latest_payslip.month)}</b><div className="muted small">Net salary</div></div><div className="row"><b style={{ fontSize: 22 }}>{money(d.latest_payslip.net)}</b><Badge tone={d.latest_payslip.status === 'paid' ? 'ok' : 'info'}>{d.latest_payslip.status}</Badge></div></div> : <span className="muted">No payslip yet.</span>}</Card></div>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth(); const { data, loading, error, reload } = useFetch('/dashboard');
  const V = { admin: Admin, finance: Finance, teacher: Teacher, parent: Family, student: Family, driver: Driver }[user.role];
  return (
    <>
      <PageHead title={`${greeting()}, ${user.name.split(' ')[0]}`} sub={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
      <ErrorBox error={error} retry={reload} />
      {loading ? <Loading rows={4} /> : data && V && <V d={data} />}
    </>
  );
}

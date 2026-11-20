import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { ChildProvider } from './lib/child.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';

const P = (f) => lazy(f);
const Dashboard = P(() => import('./pages/Dashboard.jsx'));
const Students = P(() => import('./pages/Students.jsx'));
const StudentDetail = P(() => import('./pages/StudentDetail.jsx'));
const Academics = P(() => import('./pages/Academics.jsx'));
const Timetable = P(() => import('./pages/Timetable.jsx'));
const Attendance = P(() => import('./pages/Attendance.jsx'));
const Exams = P(() => import('./pages/Exams.jsx'));
const Papers = P(() => import('./pages/Papers.jsx'));
const Diary = P(() => import('./pages/Diary.jsx'));
const Fees = P(() => import('./pages/Fees.jsx'));
const Finance = P(() => import('./pages/Finance.jsx'));
const Reports = P(() => import('./pages/Reports.jsx'));
const Leaves = P(() => import('./pages/Leaves.jsx'));
const Requests = P(() => import('./pages/Requests.jsx'));
const Tickets = P(() => import('./pages/Tickets.jsx'));
const Notices = P(() => import('./pages/Notices.jsx'));
const Community = P(() => import('./pages/Community.jsx'));
const Transport = P(() => import('./pages/Transport.jsx'));
const Bus = P(() => import('./pages/Bus.jsx'));
const Drive = P(() => import('./pages/Drive.jsx'));
const HR = P(() => import('./pages/HR.jsx'));
const MyWork = P(() => import('./pages/MyWork.jsx'));
const Approvals = P(() => import('./pages/Approvals.jsx'));
const System = P(() => import('./pages/System.jsx'));
const Notifications = P(() => import('./pages/Notifications.jsx'));
const Profile = P(() => import('./pages/Profile.jsx'));

const ALL = ['admin', 'teacher', 'finance', 'parent', 'student', 'driver'];
const STAFF = ['admin', 'teacher'];
const FAMILY = ['parent', 'student'];

function Guard({ roles = ALL, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}
const R = (path, el, roles) => <Route path={path} element={<Guard roles={roles}>{el}</Guard>} />;

export default function App() {
  const { user, booting } = useAuth();
  if (booting) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Loading rows={2} /></div>;
  if (!user) return <Login />;
  if (user.must_change_password) return (
    <ChildProvider><Routes><Route element={<Layout />}><Route path="*" element={<Suspense fallback={<Loading />}><Profile forced /></Suspense>} /></Route></Routes></ChildProvider>
  );
  return (
    <ChildProvider>
      <Suspense fallback={<div className="content"><Loading /></div>}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            {R('students', <Students />, ['admin', 'teacher', 'finance', 'parent', 'student'])}
            {R('students/:id', <StudentDetail />, ['admin', 'teacher', 'finance', 'parent', 'student'])}
            {R('academics', <Academics />, ['admin'])}
            {R('timetable', <Timetable />, ['admin', 'teacher', 'parent', 'student'])}
            {R('attendance', <Attendance />, ['admin', 'teacher', 'parent', 'student'])}
            {R('exams', <Exams />, ['admin', 'teacher', 'parent', 'student'])}
            {R('papers', <Papers />, ['admin', 'teacher', 'parent', 'student'])}
            {R('diary', <Diary />, ['admin', 'teacher', 'parent', 'student'])}
            {R('fees', <Fees />, ['admin', 'finance', 'parent', 'student'])}
            {R('finance', <Finance />, ['admin', 'finance'])}
            {R('reports', <Reports />, ['admin', 'finance'])}
            {R('leaves', <Leaves />, ['admin', 'teacher', 'parent', 'student'])}
            {R('requests', <Requests />, ['admin', 'teacher', 'parent'])}
            {R('tickets', <Tickets />, ['admin', 'teacher', 'parent', 'student'])}
            {R('tickets/:id', <Tickets />, ['admin', 'teacher', 'parent', 'student'])}
            {R('notices', <Notices />)}
            {R('community', <Community />, ['admin', 'teacher', 'parent', 'student'])}
            {R('transport', <Transport />, ['admin'])}
            {R('bus', <Bus />, FAMILY)}
            {R('drive', <Drive />, ['driver'])}
            {R('hr', <HR />, ['admin', 'finance'])}
            {R('my-work', <MyWork />, ['teacher', 'finance', 'driver'])}
            {R('approvals', <Approvals />, ['admin'])}
            {R('id-templates', <System tab="templates" />, ['admin'])}
            {R('jobs', <System tab="jobs" />, ['admin'])}
            {R('audit', <System tab="audit" />, ['admin'])}
            {R('settings', <System tab="settings" />, ['admin'])}
            {R('notifications', <Notifications />)}
            {R('profile', <Profile />)}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ChildProvider>
  );
}

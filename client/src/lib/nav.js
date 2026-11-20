import { LayoutDashboard, Users, GraduationCap, CalendarCheck, ClipboardList, FileText, Wallet, Landmark, BarChart3, CalendarOff, MessageSquareWarning,
  LifeBuoy, Megaphone, BookOpen, MessagesSquare, Bus, UserCog, ShieldCheck, Settings, Clock, Bell, IdCard, FolderOpen, Receipt, Calendar, UserCheck, Activity, Timer, Briefcase } from 'lucide-react';

// Each role gets its own grouped menu. Pages guard themselves on the server too: this only shapes the UI.
const common = [
  { to: '/notices', label: 'Notices & Events', icon: Megaphone },
  { to: '/community', label: 'Community', icon: MessagesSquare },
];
export const NAV = {
  admin: [
    { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/approvals', label: 'Accounts & Approvals', icon: UserCheck }] },
    { group: 'Students', items: [{ to: '/students', label: 'Students', icon: GraduationCap }, { to: '/academics', label: 'Classes & Subjects', icon: BookOpen }, { to: '/timetable', label: 'Timetable', icon: Clock },
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck }, { to: '/exams', label: 'Exams & Marks', icon: ClipboardList }, { to: '/papers', label: 'Question Papers', icon: FolderOpen }, { to: '/diary', label: 'Class Diary', icon: BookOpen }] },
    { group: 'Requests', items: [{ to: '/leaves', label: 'Leave Requests', icon: CalendarOff }, { to: '/requests', label: 'Change Requests', icon: MessageSquareWarning }, { to: '/tickets', label: 'Support Tickets', icon: LifeBuoy }] },
    { group: 'Finance', items: [{ to: '/fees', label: 'Fees & Invoices', icon: Receipt }, { to: '/finance', label: 'Cash, Expenses, Budget', icon: Landmark }, { to: '/reports', label: 'Reports', icon: BarChart3 }] },
    { group: 'People', items: [{ to: '/hr', label: 'HRMS & Payroll', icon: Briefcase }, { to: '/transport', label: 'Transport', icon: Bus }] },
    { group: 'Communicate', items: [...common] },
    { group: 'System', items: [{ to: '/id-templates', label: 'ID Card Templates', icon: IdCard }, { to: '/jobs', label: 'Scheduled Jobs', icon: Timer }, { to: '/audit', label: 'Audit Trail', icon: ShieldCheck }, { to: '/settings', label: 'Settings', icon: Settings }] },
  ],
  teacher: [
    { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/timetable', label: 'My Timetable', icon: Clock }] },
    { group: 'My Classes', items: [{ to: '/students', label: 'Students', icon: GraduationCap }, { to: '/attendance', label: 'Attendance', icon: CalendarCheck }, { to: '/exams', label: 'Exams & Marks', icon: ClipboardList },
      { to: '/papers', label: 'Question Papers', icon: FolderOpen }, { to: '/diary', label: 'Class Diary', icon: BookOpen }] },
    { group: 'Class Teacher Desk', items: [{ to: '/leaves', label: 'Leave Requests', icon: CalendarOff }, { to: '/requests', label: 'Change Requests', icon: MessageSquareWarning }, { to: '/tickets', label: 'Parent Support', icon: LifeBuoy }] },
    { group: 'Communicate', items: [...common] },
    { group: 'Me', items: [{ to: '/my-work', label: 'My Leave & Payslips', icon: Briefcase }] },
  ],
  finance: [
    { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }] },
    { group: 'Fees', items: [{ to: '/fees', label: 'Fees & Collection', icon: Receipt }, { to: '/finance', label: 'Cash, Expenses, Budget', icon: Landmark }, { to: '/reports', label: 'Reports', icon: BarChart3 }] },
    { group: 'People', items: [{ to: '/hr', label: 'Payroll & Staff', icon: Briefcase }] },
    { group: 'Communicate', items: [{ to: '/notices', label: 'Notices & Events', icon: Megaphone }] },
    { group: 'Me', items: [{ to: '/my-work', label: 'My Leave & Payslips', icon: Briefcase }] },
  ],
  parent: [
    { group: 'My Child', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/students', label: 'Profile & ID Card', icon: IdCard }, { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
      { to: '/exams', label: 'Marks & Results', icon: ClipboardList }, { to: '/timetable', label: 'Timetable', icon: Clock }, { to: '/diary', label: 'Class Diary', icon: BookOpen }, { to: '/papers', label: 'Question Papers', icon: FolderOpen }] },
    { group: 'Fees', items: [{ to: '/fees', label: 'Fees & Payments', icon: Wallet }] },
    { group: 'Requests', items: [{ to: '/leaves', label: 'Leave', icon: CalendarOff }, { to: '/requests', label: 'Change Details', icon: MessageSquareWarning }, { to: '/tickets', label: 'Talk to Class Teacher', icon: LifeBuoy }] },
    { group: 'School', items: [{ to: '/bus', label: 'Bus Tracking', icon: Bus }, ...common] },
  ],
  student: [
    { group: 'Me', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/students', label: 'Profile & ID Card', icon: IdCard }, { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
      { to: '/exams', label: 'Marks & Results', icon: ClipboardList }, { to: '/timetable', label: 'Timetable', icon: Clock }, { to: '/diary', label: 'Class Diary', icon: BookOpen }, { to: '/papers', label: 'Question Papers', icon: FolderOpen }] },
    { group: 'More', items: [{ to: '/fees', label: 'Fees (view)', icon: Wallet }, { to: '/leaves', label: 'Leave', icon: CalendarOff }, { to: '/tickets', label: 'Support', icon: LifeBuoy }, { to: '/bus', label: 'Bus Tracking', icon: Bus }, ...common] },
  ],
  driver: [
    { group: 'Driver', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/drive', label: 'Trip Console', icon: Bus }, { to: '/my-work', label: 'My Leave & Payslips', icon: Briefcase }] },
    { group: 'School', items: [{ to: '/notices', label: 'Notices', icon: Megaphone }] },
  ],
};

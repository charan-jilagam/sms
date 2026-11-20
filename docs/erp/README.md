# School ERP (Node + React + SQLite)

A second, self-contained stack that lives beside the original Laravel app. Nothing in the Laravel code was changed.

| Layer | Tech |
|---|---|
| API | Node 22, Express 4, `better-sqlite3` (WAL), JWT, `node-cron` |
| UI | React 18, Vite 5, React Router 6 (light and dark theme, no UI framework) |
| Data | One SQLite file (`server/data/school.db`) |

## Manuals

| Guide | For |
|---|---|
| [Setup & deployment](setup.md) | Whoever installs it |
| [Administrator manual](admin.md) | Principal / office admin |
| [Class teacher & teacher manual](teacher.md) | Class teachers and subject teachers |
| [Parent & student manual](parent-student.md) | Families |
| [Driver manual](driver.md) | Bus drivers (co-driver details included) |
| [Finance manual](finance.md) | Accountant / fee clerk |
| [Cron jobs](cron-jobs.md) | Scheduled automations |
| [Database techniques](database.md) | Developers |

## Who can see what

| Area | Admin | Teacher | Class teacher* | Finance | Parent | Student | Driver |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Accounts & approvals | ✔ | | | | | | |
| Students (add / edit / deactivate) | ✔ | view own classes | edit class | | own children | self | |
| Attendance & marks | ✔ | mark own subjects | whole class | | view | view | |
| Timetable (auto-generate) | ✔ | view | view | | view | view | |
| Question papers | ✔ | upload / release | upload / release | | released only | released only | |
| Fees, invoices, receipts | ✔ | | | ✔ | pay online | view | |
| Cash book, deposits, expenses, budgets | ✔ | | | ✔ | | | |
| Bank deposit **verification** | ✔ | | | | | | |
| Late-fee waiver | ✔ | | | | | | |
| Leave (student) | ✔ | | approve | | apply | apply | |
| Change requests | name & DOB | | other fields | | raise | raise | |
| Support tickets | ✔ | | answer | | raise | raise | |
| HRMS, staff attendance, payroll | ✔ | own leave & payslips | same | payroll | | | own leave & payslips |
| Transport admin and live fleet | ✔ | | | vehicles (view) | | | |
| Live bus tracking | fleet | | | | own child | own bus | |
| Trip console | | | | | | | ✔ |
| ID templates, jobs, audit, settings | ✔ | | | | | | |

\* A class teacher is a teacher who is set as the *class teacher* of a class. It is not a separate login role.

Hierarchy: **Admin → Class teacher → Staff → Parent → Driver → Finance.**

# Administrator manual

## First day checklist
1. **Settings** (System → Settings): school name, address, currency, academic year, late-fee %, reminder days, fiscal-year start month.
2. **Accounts**: create teachers, finance staff, drivers (Accounts → Create account). A temporary password is shown once.
3. **Classes & subjects** (Classes & Subjects): create classes, choose each class teacher, assign subject teachers.
4. **Periods & timetable**: define the periods, then press **Auto-generate** (see below).
5. **Students**: add students (export to CSV is available), then link parents.
6. **Fee structure** (Fees → Fee structure), then **Generate invoices**.
7. **Transport**: vehicles, routes and stops, riders.

## Accounts & approvals
* Parents, drivers, teachers and finance staff can **self-register**. They stay *Pending* and cannot sign in until you press **Approve**.
* A parent's registration lists the admission numbers they entered. Approving links those children automatically (use the link icon to fix or add).
* You may also **create** an account directly. It is active at once.
* **Deactivate** locks a user out on their very next request. **Reset password** signs them out everywhere.
* Students sign in with their admission number. Parents sign in with their mobile number.

## Students
* **Add student**: the mobile number plus name creates a unique key. Duplicates are refused.
* Each student gets an ID card number and a printable **ID card** (profile → ID card). Design cards under System → ID templates.
* **Deactivate / reactivate** a student from the profile. The class teacher can request it, you decide. Deactivated students drop off attendance, invoices and transport lists, and the linked login is locked.
* Name and date of birth changes requested by parents come to **you**. Everything else goes to the class teacher.

## Timetable automation
Timetable → **Auto-generate**. Choose the days, press **Preview** to see the result and any subjects that could not be placed, then **Save timetable**. It uses each class's subject and teacher assignments (periods per week), round-robin, and never puts one teacher in two classes in the same period. You can generate for one class or all classes.

## Finance oversight
* **Verify bank deposits** (Finance → Bank deposits): the clerk submits the slip number, you verify or reject. Only you can do this.
* **Waive a late fee** (Fees → invoice → Waive). Audited.
* **Concession / scholarship** on any invoice (tag icon).
* Reports: fee collection (by day / month / mode / class / fee head), outstanding dues, expenses, class strength. Every report exports to CSV.

## HRMS
* Employees: teaching, non-teaching, drivers, co-drivers (licence number and expiry for drivers).
* Staff attendance and staff leave approval.
* **Payroll**: the draft appears on the 1st automatically (cron). Review, adjust bonus / deductions, **Finalize** (payslips become visible), **Mark as paid** (books a *Payroll* expense and notifies staff).

## Transport
* Vehicles with insurance and fitness expiry, driver and co-driver.
* Routes: name, *via* details, ordered stops with times and (optionally) latitude / longitude. The last stop is the school.
* Riders: assign each student to a route and stop. Capacity is enforced.
* **Live fleet**: every bus on a trip appears on the map and updates every 8 s.

## Communication
* **Notices, events, holidays, circulars** to everyone or an audience (parents, students, staff, drivers, one class). Everyone targeted is notified. Events and holidays also appear in the calendar.
* **Community**: school-wide posts, pinning, moderation.

## System
* **Scheduled jobs**: see last run, run any job now.
* **Audit trail**: append-only record of sensitive actions. The database itself refuses edits and deletes.
* **Backups**: nightly, plus *Back up now*. Download from the page.
* **Outbox**: every SMS / e-mail the system tried to send.

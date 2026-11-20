import { get, run, nextSeq } from '../db/index.js';

const TYPE_BY_ROLE = { teacher: 'teacher', finance: 'finance', driver: 'driver', admin: 'admin_staff' };

/** Every staff-type login gets an HR record so payroll / leave / attendance just work. */
export function ensureEmployee(user) {
  const type = TYPE_BY_ROLE[user.role];
  if (!type) return null;
  const ex = get('SELECT * FROM employees WHERE user_id = ?', user.id);
  if (ex) return ex;
  const code = nextSeq('employee', 'EMP', 4);
  const info = run(
    `INSERT INTO employees(user_id, emp_code, name, mobile, type, designation, join_date)
     VALUES (?,?,?,?,?,?, date('now'))`,
    user.id, code, user.name, user.mobile, type, user.role === 'teacher' ? 'Teacher' : user.role === 'driver' ? 'Bus Driver' : null,
  );
  return get('SELECT * FROM employees WHERE id = ?', info.lastInsertRowid);
}
export const employeeOfUser = (userId) => get('SELECT * FROM employees WHERE user_id = ?', userId);

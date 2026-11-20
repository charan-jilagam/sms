import { all, get, run, db } from '../db/index.js';
import { flushSoon } from './dispatch.js';

const insertN = () => db.prepare('INSERT INTO notifications(user_id, title, body, kind, link) VALUES (?,?,?,?,?)');

/** In-app notification to one or more users. With sms:true it is also queued as SMS (and e-mail when the user has one) and delivered by dispatch.js. */
export function notify(userIds, { title, body = null, kind = 'info', link = null, sms = false }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  if (!ids.length) return 0;
  const ins = insertN();
  const doAll = db.transaction(() => {
    for (const id of ids) {
      ins.run(id, title, body, kind, link);
      if (sms) {
        const u = get('SELECT mobile, email FROM users WHERE id = ?', id);
        if (u?.mobile) run("INSERT INTO outbox(channel, to_addr, subject, body) VALUES ('sms', ?, ?, ?)", u.mobile, title, body ? `${title}: ${body}` : title);
        if (u?.email) run("INSERT INTO outbox(channel, to_addr, subject, body) VALUES ('email', ?, ?, ?)", u.email, title, body || title);
      }
    }
  });
  doAll();
  if (sms) flushSoon();
  return ids.length;
}

export const parentIdsOf = (studentId) =>
  all(`SELECT ps.parent_user_id AS id FROM parent_students ps JOIN users u ON u.id = ps.parent_user_id
       WHERE ps.student_id = ? AND u.status = 'active'`, studentId).map((r) => r.id);

export const studentUserOf = (studentId) => get('SELECT user_id FROM students WHERE id = ?', studentId)?.user_id || null;

export function notifyFamily(studentId, payload) {
  return notify([...parentIdsOf(studentId), studentUserOf(studentId)], payload);
}
export const adminIds = () => all("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").map((r) => r.id);
export const notifyAdmins = (payload) => notify(adminIds(), payload);
export const classTeacherOf = (classId) => get('SELECT class_teacher_id AS id FROM classes WHERE id = ?', classId)?.id || null;

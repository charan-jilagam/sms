import { all, get } from '../db/index.js';
import { forbidden, notFound } from './http.js';

export function teacherClasses(userId) {
  const ct = all('SELECT id FROM classes WHERE class_teacher_id = ?', userId).map((r) => r.id);
  const teaching = all('SELECT DISTINCT class_id AS id FROM class_subjects WHERE teacher_id = ?', userId).map((r) => r.id);
  return { ct, teaching, all: [...new Set([...ct, ...teaching])] };
}

export function childIds(user) {
  if (user.role === 'parent') return all('SELECT student_id AS id FROM parent_students WHERE parent_user_id = ?', user.id).map((r) => r.id);
  if (user.role === 'student') return all('SELECT id FROM students WHERE user_id = ?', user.id).map((r) => r.id);
  return [];
}

/**
 * Returns { student, level } where level is one of:
 *  admin | finance | ct (class teacher: manage) | teacher (subject teacher: read/marks) | family (parent/student)
 * Throws 404/403 otherwise.
 */
export function studentAccess(user, studentId) {
  const s = get('SELECT * FROM students WHERE id = ?', studentId);
  if (!s) throw notFound('Student not found');
  if (user.role === 'admin') return { student: s, level: 'admin' };
  if (user.role === 'finance') return { student: s, level: 'finance' };
  if (user.role === 'teacher') {
    if (s.class_id) {
      const c = get('SELECT class_teacher_id FROM classes WHERE id = ?', s.class_id);
      if (c?.class_teacher_id === user.id) return { student: s, level: 'ct' };
      if (get('SELECT 1 x FROM class_subjects WHERE class_id = ? AND teacher_id = ?', s.class_id, user.id)) return { student: s, level: 'teacher' };
    }
    throw forbidden('This student is not in one of your classes');
  }
  if (user.role === 'parent' || user.role === 'student') {
    if (childIds(user).includes(Number(studentId))) return { student: s, level: 'family' };
    throw forbidden('This is not your child');
  }
  if (user.role === 'driver') throw forbidden();
  throw forbidden();
}
export const canManage = (level) => level === 'admin' || level === 'ct';

/** SQL fragment restricting a students table alias to what the user may see. */
export function visibleStudents(user, alias = 's') {
  const a = alias;
  if (user.role === 'admin' || user.role === 'finance') return { sql: '1=1', params: [] };
  if (user.role === 'teacher') {
    const ids = teacherClasses(user.id).all;
    if (!ids.length) return { sql: '0=1', params: [] };
    return { sql: `${a}.class_id IN (${ids.map(() => '?').join(',')})`, params: ids };
  }
  if (user.role === 'parent') return { sql: `${a}.id IN (SELECT student_id FROM parent_students WHERE parent_user_id = ?)`, params: [user.id] };
  if (user.role === 'student') return { sql: `${a}.user_id = ?`, params: [user.id] };
  if (user.role === 'driver') {
    return {
      sql: `${a}.id IN (SELECT st.student_id FROM student_transport st JOIN routes r ON r.id = st.route_id
                        JOIN vehicles v ON v.id = r.vehicle_id JOIN employees e ON e.id = v.driver_employee_id
                        WHERE e.user_id = ?)`,
      params: [user.id],
    };
  }
  return { sql: '0=1', params: [] };
}

export function ownClassOrAdmin(user, classId) {
  if (user.role === 'admin') return 'admin';
  if (user.role === 'teacher') {
    const c = get('SELECT class_teacher_id FROM classes WHERE id = ?', classId);
    if (!c) throw notFound('Class not found');
    if (c.class_teacher_id === user.id) return 'ct';
    if (get('SELECT 1 x FROM class_subjects WHERE class_id = ? AND teacher_id = ?', classId, user.id)) return 'teacher';
  }
  throw forbidden('This class is not assigned to you');
}

export function driverVehicle(userId) {
  return get(`SELECT v.* FROM vehicles v JOIN employees e ON e.id = v.driver_employee_id WHERE e.user_id = ?`, userId);
}

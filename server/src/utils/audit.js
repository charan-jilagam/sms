import { run } from '../db/index.js';

export function audit(req, action, entity = null, entityId = null, details = null) {
  try {
    const u = req?.user;
    run(
      'INSERT INTO audit_log(user_id, user_name, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?)',
      u?.id ?? null, u?.name ?? null, action, entity, entityId == null ? null : String(entityId),
      details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)),
      req?.ip ?? null,
    );
  } catch (e) { console.error('audit failed', e.message); }
}
export function auditSystem(action, entity, entityId, details) {
  audit({ user: { id: null, name: 'system' }, ip: null }, action, entity, entityId, details);
}

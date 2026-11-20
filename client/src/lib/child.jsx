import { createContext, useContext, useEffect, useMemo } from 'react';
import { useAuth } from './auth.jsx';
import { useFetch, useLocalState } from './hooks.js';

const Ctx = createContext({ children: [], child: null, setChildId: () => {}, loading: true });
export const useChild = () => useContext(Ctx);

/** Parents (and students) can have several children; every family page works on the selected child. */
export function ChildProvider({ children: kids }) {
  const { user } = useAuth();
  const isFamily = user && (user.role === 'parent' || user.role === 'student');
  const { data, loading } = useFetch(isFamily ? '/students' : null);
  const [childId, setChildId] = useLocalState('erp_child', null);
  const list = data?.rows || [];
  const child = list.find((c) => c.id === childId) || list[0] || null;
  useEffect(() => { if (child && child.id !== childId) setChildId(child.id); }, [child, childId, setChildId]);
  const value = useMemo(() => ({ children: list, child, setChildId, loading }), [list, child, setChildId, loading]);
  return <Ctx.Provider value={value}>{kids}</Ctx.Provider>;
}

export function ChildBar() {
  const { children, child, setChildId } = useChild();
  if (children.length < 2) return null;
  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <span className="muted small bold">Viewing:</span>
      {children.map((c) => <button key={c.id} className={`chip ${child?.id === c.id ? 'on' : ''}`} onClick={() => setChildId(c.id)}>{c.name} <span className="muted">· {c.class_label || '-'}</span></button>)}
    </div>
  );
}

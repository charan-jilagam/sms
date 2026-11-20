import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** GET helper: const { data, loading, error, reload } = useFetch('/classes') ; pass null to skip */
export function useFetch(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: !!path, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path);
      if (id === seq.current) setState({ data, loading: false, error: null });
    } catch (e) { if (id === seq.current) setState({ data: null, loading: false, error: e.message }); }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load };
}

export function useLocalState(key, initial) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV];
}

export function useInterval(fn, ms, enabled = true) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { if (!enabled) return undefined; const id = setInterval(() => ref.current(), ms); return () => clearInterval(id); }, [ms, enabled]);
}

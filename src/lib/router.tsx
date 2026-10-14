// 의존성 없는 최소 라우터 (History API). 경로가 몇 개뿐이라 react-router 없이 충분하다.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode, type MouseEvent } from 'react';

type NavigateOptions = { replace?: boolean; state?: unknown };
type RouterValue = {
  path: string; // pathname + search
  pathname: string;
  search: URLSearchParams;
  state: unknown;
  navigate: (to: string, opts?: NavigateOptions) => void;
  back: (fallback?: string) => void;
};

const RouterContext = createContext<RouterValue | null>(null);

const currentPath = () => window.location.pathname + window.location.search;

/**
 * 히스토리 항목마다 { __app, n(앱 내 이동 깊이), s(사용자 state) } 를 저장한다.
 * document.referrer 는 pushState 이동 후에도 바뀌지 않으므로, 앱 안에서 쌓인 깊이로 '뒤로'를 판단한다.
 */
type HState = { __app?: true; n?: number; s?: unknown } | null;
const readH = (): HState => (window.history.state as HState) ?? null;
const depthNow = () => readH()?.n ?? 0;
const userState = () => readH()?.s ?? null;

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath);
  const [state, setState] = useState<unknown>(userState);

  useEffect(() => {
    const onPop = () => {
      setPath(currentPath());
      setState(userState());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, opts: NavigateOptions = {}) => {
    const n = opts.replace ? depthNow() : depthNow() + 1;
    const payload: HState = { __app: true, n, s: opts.state ?? null };
    if (opts.replace) window.history.replaceState(payload, '', to);
    else window.history.pushState(payload, '', to);
    setPath(currentPath());
    setState(opts.state ?? null);
    if (!opts.replace) window.scrollTo(0, 0);
  }, []);

  const back = useCallback(
    (fallback = '/') => {
      // 앱 안에서 한 번이라도 이동해 쌓인 기록이 있으면 실제 뒤로가기, 없으면(외부에서 바로 들어온 경우) fallback
      if (depthNow() > 0) window.history.back();
      else navigate(fallback, { replace: true });
    },
    [navigate],
  );

  const value = useMemo<RouterValue>(() => {
    const [pathname, query = ''] = path.split('?');
    return { path, pathname, search: new URLSearchParams(query), state, navigate, back };
  }, [path, state, navigate, back]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('RouterProvider 가 필요합니다');
  return ctx;
}

/** '/c/:id/members' 같은 패턴과 경로를 비교해 파라미터를 돌려준다 */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = pathname.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Navigate({ to, replace = true, state }: { to: string; replace?: boolean; state?: unknown }) {
  const { navigate } = useRouter();
  useEffect(() => {
    navigate(to, { replace, state });
  }, [to, replace, state, navigate]);
  return null;
}

export function Link({ to, className, children, ariaLabel }: { to: string; className?: string; children: ReactNode; ariaLabel?: string }) {
  const { navigate } = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} className={className} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </a>
  );
}

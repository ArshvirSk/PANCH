'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

type State = 'checking' | 'online' | 'offline';

/** Footer indicator backed by the public GET /health route. */
export function ApiStatus() {
  const { api } = useAuth();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    let active = true;
    api
      .health()
      .then((res) => active && setState(res.ok ? 'online' : 'offline'))
      .catch(() => active && setState('offline'));
    return () => {
      active = false;
    };
  }, [api]);

  const label = { checking: 'Checking service…', online: 'All systems operational', offline: 'Service unreachable' }[state];
  return (
    <span className={`api-status api-status-${state}`} data-testid="api-status" data-state={state}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

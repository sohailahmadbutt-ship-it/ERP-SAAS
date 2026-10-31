'use client';
import { createContext, useContext } from 'react';
import type { Tenant, User } from './api';

export interface Session {
  tenant: Tenant;
  user: User;
  reload: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside the /app layout');
  return s;
}

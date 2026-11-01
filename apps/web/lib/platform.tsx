'use client';
import { createContext, useContext } from 'react';

export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
}

export const PlatformContext = createContext<PlatformAdmin | null>(null);

export function usePlatformAdmin() {
  const a = useContext(PlatformContext);
  if (!a) throw new Error('usePlatformAdmin must be used inside the /platform layout');
  return a;
}

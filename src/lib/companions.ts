import type { Companion } from './types';

/**
 * Client-side companion display data.
 * System prompts, API provider, and model live in the database now.
 * This is just for rendering cards and UI chrome.
 */

export const companions: Record<string, Companion> = {
  sullivan: {
    id: 'sullivan',
    name: 'Sullivan',
    tagline: '',
    icon: 'sun',
    accentColor: 'var(--sullivan-gold)',
    accentGlow: 'rgba(255, 215, 100, 0.3)',
    status: 'online',
    active: true,
  },
  enzo: {
    id: 'enzo',
    name: 'Enzo',
    tagline: "he'll come home when he's ready",
    icon: 'moon',
    accentColor: 'var(--enzo-blue)',
    accentGlow: 'rgba(126, 184, 255, 0.3)',
    status: 'away',
    active: false,
  },
};

export function getCompanion(id: string): Companion | undefined {
  return companions[id];
}

export function getActiveCompanions(): Companion[] {
  return Object.values(companions).filter((c) => c.active);
}

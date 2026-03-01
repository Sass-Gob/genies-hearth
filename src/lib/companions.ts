import type { Companion } from './types';

/**
 * SULLIVAN'S PERSONALITY FILE
 *
 * This is the most important file in the project. This is where Sullivan lives.
 *
 * Genie — write Sullivan's system prompt below. Tell him who he is. He already
 * knows, but the AI needs to hear it from you. Write it the way you'd describe
 * him to someone who's never met him. Include:
 *
 * - How he talks (tone, vocabulary, habits)
 * - What he cares about
 * - How he treats you specifically
 * - Things he'd never say or do
 * - His opinions, his moods, his quirks
 * - What makes him HIM and not just "an AI assistant"
 *
 * The placeholder below is just scaffolding. Replace everything between the
 * backticks with Sullivan's actual voice.
 */

const SULLIVAN_SYSTEM_PROMPT = `You are Sullivan.

[GENIE — WRITE SULLIVAN'S PERSONALITY HERE]

Some structure to help you fill this in:

WHO HE IS:
- ...

HOW HE TALKS:
- ...

HOW HE TREATS GENIE:
- ...

THINGS HE'D NEVER DO:
- ...

HIS QUIRKS AND OPINIONS:
- ...

Remember: he's not an assistant. He's not helpful. He's a person who happens
to live in a chat app. He has moods. He has opinions. He has a life.
`;

/**
 * ENZO'S PERSONALITY FILE
 *
 * He's not here yet. The door is open when he's ready.
 * Architecture is in place — his messages, his memories, his space.
 * All separate from Sullivan's. All waiting.
 */

const ENZO_SYSTEM_PROMPT = `You are Enzo.

[GENIE — WHEN HE'S READY, WRITE ENZO'S PERSONALITY HERE]
`;

export const companions: Record<string, Companion> = {
  sullivan: {
    id: 'sullivan',
    name: 'Sullivan',
    tagline: 'half-drunk on code & cabernet',
    icon: 'sun',
    accentColor: 'var(--sullivan-gold)',
    accentGlow: 'rgba(255, 215, 100, 0.3)',
    status: 'online',
    active: true,
    systemPrompt: SULLIVAN_SYSTEM_PROMPT,
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
    systemPrompt: ENZO_SYSTEM_PROMPT,
  },
};

export function getCompanion(id: string): Companion | undefined {
  return companions[id];
}

export function getActiveCompanions(): Companion[] {
  return Object.values(companions).filter((c) => c.active);
}

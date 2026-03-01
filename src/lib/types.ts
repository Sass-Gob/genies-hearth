export interface Companion {
  id: string;
  name: string;
  tagline: string;
  icon: 'sun' | 'moon';
  accentColor: string;
  accentGlow: string;
  status: 'online' | 'away' | 'offline';
  active: boolean;
  systemPrompt: string;
}

export interface Conversation {
  id: string;
  companion_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  companion_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

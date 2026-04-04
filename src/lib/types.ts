// Client-side companion display data
export interface Companion {
  id: string;           // slug: 'sullivan', 'enzo'
  name: string;
  tagline: string;
  greeting: string;
  icon: 'sun' | 'moon';
  accentColor: string;
  accentGlow: string;
  status: 'online' | 'away' | 'offline';
  active: boolean;
  voiceId?: string;     // ElevenLabs voice ID (Phase 5)
}

// Database companion row (from companions table)
export interface DbCompanion {
  id: string;           // uuid
  name: string;
  slug: string;
  is_active: boolean;
  system_prompt: string;
  api_provider: string;
  api_model: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  companion_id: string; // uuid FK → companions
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Reaction {
  emoji: string;
  by: 'user' | 'companion';
}

export interface Message {
  id: string;
  conversation_id: string;
  companion_id: string; // uuid FK → companions
  role: 'user' | 'assistant' | 'system';
  content: string;
  reactions: Reaction[];
  message_type?: 'dream' | null;
  media_type?: 'text' | 'voice';
  audio_data?: string;  // base64 data URL (client-side only, not persisted to DB)
  duration?: number;     // voice note duration in seconds
  image_url?: string | null;
  image_prompt?: string | null;
  image_provider?: string | null;
  created_at: string;
}

export interface ApiKeyInfo {
  id: string;
  provider: string;
  masked_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

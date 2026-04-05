import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getCompanion } from '../lib/companions';
import { useTTS } from '../hooks/useTTS';
import type { Message, Conversation, DbCompanion, Reaction, ChatAttachment } from '../lib/types';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker once at module load. Vite's ?url suffix rewrites
// this to a hashed asset URL at build time so it's served from /assets/.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Extract plain text from a PDF File. Returns the concatenated text of all
// pages, capped to match the text-file limit used elsewhere in processFile.
// Swallows any per-page errors so one bad page doesn't kill the whole doc.
async function extractPdfText(file: File, charLimit = 15000): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pageTexts: string[] = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ('str' in it && typeof it.str === 'string' ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        pageTexts.push(`--- page ${i} ---\n${text}`);
        total += text.length;
      }
    } catch (e) {
      console.error(`[PDF] page ${i} extract failed:`, e);
    }
    if (total >= charLimit) break;
  }
  const joined = pageTexts.join('\n\n');
  return joined.length > charLimit ? joined.slice(0, charLimit) + '\n[… truncated]' : joined;
}

interface Props {
  companionSlug: string;
  onBack: () => void;
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const period = hours < 12 ? 'am' : 'pm';
  const displayHour = hours % 12 || 12;
  const timeOfDay =
    hours < 6 ? 'late night' :
    hours < 12 ? 'morning' :
    hours < 17 ? 'afternoon' :
    hours < 21 ? 'evening' : 'tonight';
  return `✦ ${timeOfDay} · ${displayHour}:${minutes} ${period} ✦`;
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const period = hours < 12 ? 'am' : 'pm';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${period}`;
}

function shouldShowTimestamp(current: Message, previous: Message | undefined): boolean {
  if (!previous) return true;
  const diff = new Date(current.created_at).getTime() - new Date(previous.created_at).getTime();
  return diff > 30 * 60 * 1000;
}

function formatConvTitle(conv: Conversation): string {
  if (conv.title) return conv.title;
  const d = new Date(conv.created_at);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function VoiceNoteBubble({ msg, speak, stop, speakingMsgId }: {
  msg: Message;
  speak: (text: string, msgId?: string) => void;
  stop: () => void;
  speakingMsgId: string | null;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isCompanion = msg.role === 'assistant';
  const hasAudio = !!msg.audio_data;

  function togglePlay() {
    if (isCompanion) {
      // Sullivan: browser TTS
      if (speakingMsgId === msg.id) {
        stop();
      } else {
        speak(msg.content, msg.id);
      }
    } else if (hasAudio && audioRef.current) {
      // User: recorded audio
      if (audioRef.current.paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    }
  }

  const duration = msg.duration || (isCompanion ? Math.round(msg.content.length / 15) : 0);

  return (
    <div className="vn-container">
      {hasAudio && (
        <audio
          ref={audioRef}
          src={msg.audio_data}
          onTimeUpdate={() => {
            if (audioRef.current) setAudioProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
          }}
          onEnded={() => setAudioProgress(0)}
        />
      )}
      <div className="vn-row">
        <button className="vn-play" onClick={togglePlay}>
          {(speakingMsgId === msg.id) ? '⏸' : '▶'}
        </button>
        <div className="vn-bar">
          <div className="vn-bar-fill" style={{ width: `${speakingMsgId === msg.id ? 50 : audioProgress}%` }} />
        </div>
        {duration > 0 && (
          <span className="vn-duration">{Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}</span>
        )}
      </div>
      <button className="vn-transcript-toggle" onClick={() => setShowTranscript(!showTranscript)}>
        {showTranscript ? 'Hide text' : 'Show text'}
      </button>
      {showTranscript && <div className="vn-transcript">{msg.content}</div>}
    </div>
  );
}

export default function Chat({ companionSlug, onBack }: Props) {
  const displayCompanion = getCompanion(companionSlug)!;
  const [dbCompanion, setDbCompanion] = useState<DbCompanion | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatProvider, setChatProvider] = useState('xai');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [allConversations, setAllConversations] = useState<Conversation[]>([]);
  const [showConvList, setShowConvList] = useState(false);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [convMenuId, setConvMenuId] = useState<string | null>(null);
  const [confirmDeleteConvId, setConfirmDeleteConvId] = useState<string | null>(null);
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null);
  const [msgContextMenu, setMsgContextMenu] = useState<{ msgId: string; x: number; y: number } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recTranscriptRef = useRef<string>('');
  const recRecognitionRef = useRef<any>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const { speak, stop, speakingMsgId } = useTTS();

  const companionEmoji: Record<string, string> = { sullivan: '🙄', enzo: '🌙' };
  const baseEmojis = ['😈', '👿', '🖤', '😏', '😆', '🥺'];
  const allEmojis = [...baseEmojis, companionEmoji[companionSlug] || '✨'];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  async function toggleReaction(messageId: string, emoji: string) {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;

    const existing = msg.reactions || [];
    const hasIt = existing.some((r) => r.emoji === emoji && r.by === 'user');
    const updated: Reaction[] = hasIt
      ? existing.filter((r) => !(r.emoji === emoji && r.by === 'user'))
      : [...existing, { emoji, by: 'user' as const }];

    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, reactions: updated } : m))
    );
    setReactionPickerMsgId(null);

    // Persist to DB
    await supabase
      .from('messages' as any)
      .update({ reactions: updated })
      .eq('id', messageId);

    // Feed companion_signals if adding (not removing)
    if (!hasIt && dbCompanion) {
      await supabase.from('companion_signals' as any).insert({
        companion_id: dbCompanion.id,
        signal_type: 'reaction',
        payload: { emoji, message_id: messageId, message_role: msg.role },
      });
    }
  }

  // Resolve companion slug → DB record (get UUID)
  useEffect(() => {
    async function resolveCompanion() {
      const { data } = await supabase
        .from('companions' as any)
        .select('*')
        .eq('slug', companionSlug)
        .single();

      if (data) {
        const c = data as any;
        setDbCompanion({
          id: c.id,
          name: c.name,
          slug: c.slug,
          is_active: c.is_active,
          system_prompt: c.system_prompt,
          api_provider: c.api_provider,
          api_model: c.api_model,
          created_at: c.created_at,
          updated_at: c.updated_at,
        });
      }
    }
    resolveCompanion();
  }, [companionSlug]);

  // Load chat provider preference
  useEffect(() => {
    supabase.from('user_settings' as any).select('chat_provider').limit(1).single().then(({ data }) => {
      if (data && (data as any).chat_provider) setChatProvider((data as any).chat_provider);
    });
  }, []);

  // Load conversations list + pick/create today's conversation
  useEffect(() => {
    if (!dbCompanion) return;

    async function init() {
      // Load all conversations for this companion
      const { data: convs } = await supabase
        .from('conversations' as any)
        .select('*')
        .eq('companion_id', dbCompanion!.id)
        .order('created_at', { ascending: false });

      const mapped = (convs as any[] || []).map((c) => ({
        id: c.id,
        companion_id: c.companion_id,
        title: c.title,
        created_at: c.created_at,
        updated_at: c.updated_at,
      }));
      setAllConversations(mapped);

      // Try to find today's conversation (using local date, not UTC)
      const today = new Date().toLocaleDateString('en-CA'); // "YYYY-MM-DD" in local tz
      const todayConv = mapped.find(
        (c) => new Date(c.created_at).toLocaleDateString('en-CA') === today
      );

      if (todayConv) {
        setConversation(todayConv);
      } else {
        // Create new conversation
        const { data: newConv } = await supabase
          .from('conversations' as any)
          .insert({ companion_id: dbCompanion!.id })
          .select()
          .single();

        if (newConv) {
          const conv = newConv as any;
          const mapped = {
            id: conv.id,
            companion_id: conv.companion_id,
            title: conv.title,
            created_at: conv.created_at,
            updated_at: conv.updated_at,
          };
          setConversation(mapped);
          setAllConversations((prev) => [mapped, ...prev]);
        }
      }
    }
    init();
  }, [dbCompanion]);

  // Mark autonomous messages as read when chat opens
  useEffect(() => {
    if (!dbCompanion) return;
    supabase
      .from('autonomous_messages' as any)
      .update({ status: 'read', read_at: new Date().toISOString() })
      .eq('companion_id', dbCompanion.id)
      .in('status', ['pending', 'push_sent'])
      .then(({ error }) => {
        if (error) console.error('Failed to mark autonomous messages as read:', error);
      });
  }, [dbCompanion, conversation]);

  // Load messages when conversation changes
  useEffect(() => {
    if (!conversation) return;

    async function loadMessages() {
      const { data } = await supabase
        .from('messages' as any)
        .select('*')
        .eq('conversation_id', conversation!.id)
        .order('created_at', { ascending: true });

      if (data) {
        setMessages(
          (data as any[]).map((m) => ({
            id: m.id,
            conversation_id: m.conversation_id,
            companion_id: m.companion_id,
            role: m.role,
            content: m.content,
            reactions: m.reactions || [],
            message_type: m.message_type || null,
            image_url: m.image_url || null,
            image_prompt: m.image_prompt || null,
            image_provider: m.image_provider || null,
            attachments: m.attachments || [],
            chat_provider: m.chat_provider || null,
            created_at: m.created_at,
          }))
        );
      }
    }
    loadMessages();

    // Realtime subscription
    const channel = supabase
      .channel(`messages:${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const m = payload.new as any;
          setMessages((prev) => {
            // Already have this exact ID
            if (prev.some((msg) => msg.id === m.id)) return prev;

            // Build a complete Message from the realtime payload — matches
            // the shape used by loadMessages above, so image_url, attachments,
            // image_prompt, image_provider, chat_provider, message_type all
            // survive the insert and reach the renderer. Previous versions of
            // this handler only copied a subset of fields, which silently
            // stripped every media field from assistant replies and user
            // attachments, making images invisible to the user.
            const incoming = {
              id: m.id,
              conversation_id: m.conversation_id,
              companion_id: m.companion_id,
              role: m.role,
              content: m.content,
              reactions: m.reactions || [],
              message_type: m.message_type || null,
              image_url: m.image_url || null,
              image_prompt: m.image_prompt || null,
              image_provider: m.image_provider || null,
              attachments: m.attachments || [],
              chat_provider: m.chat_provider || null,
              created_at: m.created_at,
            };

            // For user messages, replace the optimistic temp message and
            // preserve the voice-only fields (media_type/audio_data/duration)
            // that exist only on the client-side temp row and are not in the
            // DB payload.
            if (m.role === 'user') {
              const tempIdx = prev.findIndex(
                (msg) => msg.id.startsWith('temp-') && msg.role === 'user' && msg.content === m.content
              );
              if (tempIdx !== -1) {
                const updated = [...prev];
                updated[tempIdx] = {
                  ...incoming,
                  media_type: prev[tempIdx].media_type,
                  audio_data: prev[tempIdx].audio_data,
                  duration: prev[tempIdx].duration,
                };
                return updated;
              }
            }

            return [...prev, incoming];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const m = payload.new as any;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === m.id ? { ...msg, reactions: m.reactions || [] } : msg
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // Paste handler for images
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handlePaste = (e: Event) => {
      const ce = e as ClipboardEvent;
      const items = ce.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          ce.preventDefault();
          const file = item.getAsFile();
          if (file) processFile(file);
          break;
        }
      }
    };
    el.addEventListener('paste', handlePaste);
    return () => el.removeEventListener('paste', handlePaste);
  });

  async function processFile(file: File | undefined) {
    if (!file) return;
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert('File too large. Maximum size is 10MB.');
      return;
    }

    if (file.type.startsWith('image/')) {
      const filename = `chat-uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error } = await supabase.storage.from('media').upload(filename, file, { contentType: file.type });
      if (error) {
        console.error('Upload failed:', error);
        alert('Failed to upload image.');
        return;
      }
      const { data: urlData } = supabase.storage.from('media').getPublicUrl(filename);
      setAttachments(prev => [...prev, {
        id: crypto.randomUUID(),
        type: 'image',
        name: file.name,
        url: urlData.publicUrl,
        mimeType: file.type,
      }]);
    } else {
      let extractedText = '';
      try {
        if (file.type === 'application/pdf') {
          extractedText = await extractPdfText(file, 15000);
          if (!extractedText.trim()) {
            extractedText = `[PDF document: ${file.name} — no extractable text, likely a scanned image]`;
          }
        } else {
          const text = await file.text();
          extractedText = text.slice(0, 15000);
        }
      } catch (e) {
        console.error('[processFile] extraction failed:', e);
        extractedText = `[Could not read file: ${file.name}]`;
      }
      setAttachments(prev => [...prev, {
        id: crypto.randomUUID(),
        type: 'document',
        name: file.name,
        url: '',
        mimeType: file.type,
        extractedText,
      }]);
    }
    setShowAttachMenu(false);
  }

  async function sendMessage() {
    const text = input.trim();
    if (isTyping) return; // prevent double send
    if ((!text && attachments.length === 0) || !conversation || !dbCompanion) {
      console.log('sendMessage → BAILED: missing', (!text && attachments.length === 0) ? 'text/attachments' : '', !conversation ? 'conversation' : '', !dbCompanion ? 'dbCompanion' : '');
      return;
    }

    const msgText = text || (attachments.length > 0 ? `[Sent ${attachments.length} file(s)]` : '');
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsTyping(true);

    // Optimistically add user message
    const tempId = `temp-${Date.now()}`;
    const userMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      companion_id: dbCompanion.id,
      role: 'user',
      content: msgText,
      reactions: [],
      attachments: currentAttachments,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // Save user message
      await supabase.from('messages' as any).insert({
        conversation_id: conversation.id,
        companion_id: dbCompanion.id,
        role: 'user',
        content: msgText,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      });

      // Call edge function
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          conversation_id: conversation.id,
          companion_id: dbCompanion.id,
          message: msgText,
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
          chat_provider: chatProvider,
        },
      });

      if (error) throw error;

      // Handle display_message errors from the edge function
      if (data?.error && data?.display_message) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            conversation_id: conversation.id,
            companion_id: dbCompanion.id,
            role: 'assistant',
            content: data.display_message,
            reactions: [],
            created_at: new Date().toISOString(),
          },
        ]);
        return;
      }

      // Add assistant message if realtime hasn't already
      if (data?.message) {
        const m = data.message;
        setMessages((prev) => {
          if (prev.some((msg) => msg.id === m.id)) return prev;
          return [...prev, { ...m, reactions: m.reactions || [] }];
        });
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          conversation_id: conversation.id,
          companion_id: dbCompanion.id,
          role: 'assistant',
          content: "*Something's wrong with the connection. Check the settings page?*",
          reactions: [],
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  async function sendVoiceMessage(transcript: string, audioData: string, duration: number) {
    if (!conversation || !dbCompanion || isTyping) return;

    setIsTyping(true);

    // Optimistic user voice message
    const tempId = `temp-${Date.now()}`;
    const userMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      companion_id: dbCompanion.id,
      role: 'user',
      content: transcript,
      reactions: [],
      media_type: 'voice',
      audio_data: audioData,
      duration,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // Save transcript as the message content
      await supabase.from('messages' as any).insert({
        conversation_id: conversation.id,
        companion_id: dbCompanion.id,
        role: 'user',
        content: transcript,
      });

      // Call edge function with transcript
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          conversation_id: conversation.id,
          companion_id: dbCompanion.id,
          message: transcript,
        },
      });

      if (error) throw error;

      if (data?.error && data?.display_message) {
        setMessages((prev) => [...prev, {
          id: `error-${Date.now()}`,
          conversation_id: conversation.id,
          companion_id: dbCompanion.id,
          role: 'assistant',
          content: data.display_message,
          reactions: [],
          media_type: 'voice',
          created_at: new Date().toISOString(),
        }]);
        return;
      }

      if (data?.message) {
        const m = data.message;
        setMessages((prev) => {
          if (prev.some((msg) => msg.id === m.id)) return prev;
          return [...prev, { ...m, reactions: m.reactions || [], media_type: 'voice' as const }];
        });
      }
    } catch (err) {
      console.error('Failed to send voice message:', err);
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        conversation_id: conversation.id,
        companion_id: dbCompanion.id,
        role: 'assistant',
        content: "*Something's wrong with the connection. Check the settings page?*",
        reactions: [],
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setIsTyping(false);
    }
  }

  async function createNewConversation() {
    if (!dbCompanion) return;

    const { data: newConv } = await supabase
      .from('conversations' as any)
      .insert({ companion_id: dbCompanion.id })
      .select()
      .single();

    if (newConv) {
      const conv = newConv as any;
      const mapped = {
        id: conv.id,
        companion_id: conv.companion_id,
        title: conv.title,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
      };
      setConversation(mapped);
      setAllConversations((prev) => [mapped, ...prev]);
      setMessages([]);
      setShowConvList(false);
    }
  }

  function switchConversation(conv: Conversation) {
    setConversation(conv);
    setMessages([]);
    setShowConvList(false);
  }

  async function deleteConversation(convId: string) {
    // Delete all messages first, then the conversation
    await supabase.from('messages' as any).delete().eq('conversation_id', convId);
    await supabase.from('conversations' as any).delete().eq('id', convId);

    const remaining = allConversations.filter((c) => c.id !== convId);
    setAllConversations(remaining);
    setConfirmDeleteConvId(null);
    setConvMenuId(null);

    if (conversation?.id === convId) {
      if (remaining.length > 0) {
        switchConversation(remaining[0]);
      } else {
        setConversation(null);
        setMessages([]);
        setShowConvList(false);
      }
    }
  }

  async function deleteMessage(msgId: string) {
    await supabase.from('messages' as any).delete().eq('id', msgId);
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    setConfirmDeleteMsgId(null);
    setMsgContextMenu(null);
  }

  function handleMsgContextMenu(e: React.MouseEvent, msgId: string) {
    if (msgId.startsWith('temp-') || msgId.startsWith('error-')) return;
    e.preventDefault();
    setMsgContextMenu({ msgId, x: e.clientX, y: e.clientY });
  }

  function handleMsgTouchStart(msgId: string) {
    if (msgId.startsWith('temp-') || msgId.startsWith('error-')) return;
    longPressTimer.current = setTimeout(() => {
      setMsgContextMenu({ msgId, x: 0, y: 0 }); // centered on mobile
    }, 500);
  }

  function handleMsgTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  // Close context menu on outside tap
  useEffect(() => {
    if (!msgContextMenu) return;
    const handler = () => setMsgContextMenu(null);
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [msgContextMenu]);

  // Close conv menu on outside tap
  useEffect(() => {
    if (!convMenuId) return;
    const handler = () => setConvMenuId(null);
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [convMenuId]);

  // Auto-speak new assistant messages if enabled
  useEffect(() => {
    if (localStorage.getItem('hearth-tts-auto') !== 'true') return;
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && !last.id.startsWith('error-')) {
      speak(last.content, last.id);
    }
  // Only fire on messages array length change (new message)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      chunksRef.current = [];
      recTranscriptRef.current = '';

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingDuration(0);

      recTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          if (prev >= 59) { stopRecordingAndSend(); return 60; }
          return prev + 1;
        });
      }, 1000);

      // Parallel STT for transcript
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        const recognition = new SR();
        recognition.lang = 'en-GB';
        recognition.interimResults = false;
        recognition.continuous = true;
        recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              recTranscriptRef.current += event.results[i][0].transcript + ' ';
            }
          }
        };
        recognition.onerror = () => {};
        recRecognitionRef.current = recognition;
        recognition.start();
      }
    } catch (err) {
      console.error('Mic access denied:', err);
    }
  }

  function stopRecordingAndSend() {
    if (!mediaRecorderRef.current || !isRecording) return;

    setIsRecording(false);
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    recRecognitionRef.current?.stop();

    const duration = recordingDuration;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
      mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());

      // Discard if too short
      if (audioBlob.size < 3000) return;

      const audioData = await blobToBase64(audioBlob);
      const transcript = recTranscriptRef.current.trim() || '[voice note]';

      // Send as voice message
      await sendVoiceMessage(transcript, audioData, duration);
    };

    mediaRecorderRef.current.stop();
  }

  function cancelRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current.stop();
    }
    recRecognitionRef.current?.stop();
    chunksRef.current = [];
    recTranscriptRef.current = '';
    setIsRecording(false);
    setRecordingDuration(0);
    if (recTimerRef.current) clearInterval(recTimerRef.current);
  }

  // Close emoji picker on outside tap
  useEffect(() => {
    if (!reactionPickerMsgId) return;
    const handler = () => setReactionPickerMsgId(null);
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [reactionPickerMsgId]);

  // No key-based send — the only way to send is the send button

  return (
    <>
      <style>{`
        .chat-screen {
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
          z-index: 2;
        }

        /* Header */
        .chat-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(10, 14, 39, 0.8);
          backdrop-filter: blur(12px);
          flex-shrink: 0;
        }
        .chat-back {
          font-size: 20px;
          padding: 4px 8px;
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        .chat-back:hover { opacity: 1; }
        .chat-header-info {
          flex: 1;
        }
        .chat-companion-name {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 500;
          letter-spacing: 0.06em;
          color: var(--accent);
        }
        .chat-companion-status {
          font-size: 12px;
          color: var(--text-faint);
          font-style: italic;
        }
        .chat-header-actions {
          display: flex;
          gap: 6px;
        }
        .header-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          font-size: 16px;
          opacity: 0.5;
          transition: all 0.2s;
        }
        .header-btn:hover {
          opacity: 0.9;
          background: var(--glass-hover);
        }

        /* Messages area */
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .empty-chat {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
        }
        .empty-chat-text {
          font-family: var(--font-body);
          font-style: italic;
          font-size: 16px;
          color: var(--text-faint);
          text-align: center;
          line-height: 1.6;
        }

        /* Timestamp divider */
        .timestamp-divider {
          text-align: center;
          font-family: var(--font-body);
          font-style: italic;
          font-size: 12px;
          color: var(--text-faint);
          padding: 12px 0 8px;
          letter-spacing: 0.1em;
        }

        /* Message bubbles */
        .message-row {
          display: flex;
          max-width: 85%;
        }
        .message-row.user {
          align-self: flex-end;
        }
        .message-row.assistant {
          align-self: flex-start;
        }
        .message-bubble {
          padding: 10px 14px;
          line-height: 1.5;
          font-size: 16px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .message-bubble.assistant {
          background: var(--glass);
          border-radius: 4px 16px 16px 16px;
          color: var(--text-parchment);
        }
        .message-bubble.user {
          background: rgba(255, 215, 100, 0.08);
          border-radius: 16px 4px 16px 16px;
          color: var(--sullivan-gold);
        }
        /* Dream message styling */
        .message-bubble.dream {
          background: rgba(30, 20, 60, 0.85);
          border: 1px solid rgba(140, 120, 200, 0.2);
          font-style: italic;
          font-family: Georgia, 'Times New Roman', serif;
        }
        .dream-label {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-style: normal;
          font-family: var(--font-display);
          letter-spacing: 0.08em;
          color: rgba(180, 160, 220, 0.7);
          margin-bottom: 6px;
        }
        .message-time {
          font-size: 11px;
          color: var(--text-faint);
          opacity: 0.6;
          margin-top: 2px;
          font-family: var(--font-body);
          letter-spacing: 0.02em;
        }
        .message-col {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .message-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }
        .message-meta.user {
          justify-content: flex-end;
        }
        .react-btn {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 12px;
          opacity: 0;
          color: var(--text-faint);
          transition: opacity 0.2s;
        }
        .message-row:hover .react-btn {
          opacity: 0.5;
        }
        .react-btn:hover {
          opacity: 1 !important;
          background: var(--glass-hover);
        }

        /* Emoji picker */
        .emoji-picker {
          display: flex;
          gap: 2px;
          padding: 4px 6px;
          background: rgba(20, 24, 50, 0.95);
          border: 1px solid var(--border-subtle);
          border-radius: 20px;
          margin-top: 4px;
          width: fit-content;
        }
        .emoji-picker.user {
          align-self: flex-end;
        }
        .emoji-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 18px;
          transition: transform 0.15s, background 0.15s;
        }
        .emoji-btn:hover {
          transform: scale(1.25);
          background: var(--glass-hover);
        }
        .emoji-btn.active {
          background: rgba(255, 215, 100, 0.15);
        }

        /* Reaction pills */
        .reactions-row {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }
        .reactions-row.user {
          justify-content: flex-end;
        }
        .reaction-pill {
          font-size: 16px;
          padding: 2px 6px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.06);
          cursor: default;
        }
        .reaction-pill.user {
          cursor: pointer;
        }
        .reaction-pill.companion {
          border: 1px solid rgba(255, 215, 100, 0.15);
        }

        /* Typing indicator — celestial pulsing stars */
        .typing-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 12px 14px;
          align-self: flex-start;
        }
        .typing-star {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--sullivan-gold);
          animation: star-pulse 1.6s ease-in-out infinite;
          box-shadow: 0 0 4px var(--sullivan-gold);
        }
        .typing-star:nth-child(2) { animation-delay: 0.3s; }
        .typing-star:nth-child(3) { animation-delay: 0.6s; }
        @keyframes star-pulse {
          0%, 100% { transform: scale(0.5); opacity: 0.2; box-shadow: 0 0 2px var(--sullivan-gold); }
          50% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 8px var(--sullivan-gold); }
        }

        /* Input area */
        .chat-input-area {
          padding: 12px 16px;
          border-top: 1px solid var(--border-subtle);
          background: rgba(10, 14, 39, 0.8);
          backdrop-filter: blur(12px);
          display: flex;
          align-items: flex-end;
          gap: 8px;
          flex-shrink: 0;
        }
        .chat-textarea {
          flex: 1;
          min-width: 0;
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 20px;
          padding: 8px 16px;
          resize: none;
          max-height: 200px;
          overflow-y: auto;
          min-height: 36px;
          line-height: 1.4;
          font-size: 16px;
          outline: none;
          transition: border-color 0.2s;
        }
        .chat-textarea:focus {
          border-color: rgba(255, 215, 100, 0.2);
        }
        .chat-textarea::placeholder {
          color: var(--text-faint);
          font-style: italic;
        }
        .send-btn {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 18px;
          opacity: 0.7;
          color: var(--sullivan-gold);
          transition: opacity 0.2s;
          flex-shrink: 0;
        }
        .send-btn:hover { opacity: 1; }
        .mic-btn {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 16px;
          opacity: 0.5;
          color: var(--text-faint);
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .mic-btn:hover { opacity: 0.8; }
        .mic-btn.listening {
          opacity: 1;
          color: #ef4444;
          animation: mic-pulse 1.2s ease-in-out infinite;
        }
        .mic-btn.recording {
          opacity: 1;
          color: #ef4444;
        }
        @keyframes mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
          50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
        }

        /* Recording bar */
        .recording-bar {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 16px;
          min-height: 36px;
        }
        .rec-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ef4444;
          animation: mic-pulse 1.2s ease-in-out infinite;
          flex-shrink: 0;
        }
        .rec-text {
          font-size: 14px;
          color: var(--text-parchment);
          flex: 1;
        }
        .rec-cancel {
          font-size: 13px;
          color: var(--text-faint);
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        .rec-cancel:hover { opacity: 1; }

        /* Voice note bubble */
        .message-bubble.voice-note {
          min-width: 200px;
          max-width: 280px;
        }
        .vn-container {
          width: 100%;
        }
        .vn-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .vn-play {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.08);
          font-size: 14px;
          flex-shrink: 0;
          transition: background 0.15s;
        }
        .vn-play:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        .vn-bar {
          flex: 1;
          height: 3px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.12);
          overflow: hidden;
        }
        .vn-bar-fill {
          height: 100%;
          border-radius: 2px;
          background: var(--sullivan-gold);
          transition: width 0.1s linear;
        }
        .vn-duration {
          font-size: 11px;
          color: var(--text-faint);
          opacity: 0.6;
          flex-shrink: 0;
          font-family: monospace;
        }
        .vn-transcript-toggle {
          font-size: 11px;
          color: var(--text-faint);
          opacity: 0.4;
          margin-top: 6px;
          transition: opacity 0.2s;
        }
        .vn-transcript-toggle:hover { opacity: 0.7; }
        .vn-transcript {
          font-size: 13px;
          color: var(--text-faint);
          opacity: 0.6;
          margin-top: 4px;
          line-height: 1.4;
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        /* Conversation list overlay */
        .conv-overlay {
          position: absolute;
          inset: 0;
          z-index: 10;
          background: rgba(10, 14, 39, 0.95);
          backdrop-filter: blur(16px);
          display: flex;
          flex-direction: column;
        }
        .conv-overlay-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .conv-overlay-title {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.08em;
          color: var(--sullivan-gold);
        }
        .conv-close {
          font-size: 20px;
          opacity: 0.6;
          padding: 4px 8px;
          transition: opacity 0.2s;
        }
        .conv-close:hover { opacity: 1; }
        .conv-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }
        .conv-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border-radius: 8px;
          transition: background 0.2s;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .conv-item:hover {
          background: var(--glass-hover);
        }
        .conv-item.active {
          border-color: rgba(255, 215, 100, 0.15);
          background: rgba(255, 215, 100, 0.04);
        }
        .conv-item-title {
          font-size: 15px;
          color: var(--text-parchment);
          flex: 1;
        }
        .conv-item-date {
          font-size: 12px;
          color: var(--text-faint);
          white-space: nowrap;
        }
        .conv-new-btn {
          margin: 8px;
          padding: 10px;
          border-radius: 8px;
          text-align: center;
          font-family: var(--font-display);
          font-size: 13px;
          letter-spacing: 0.06em;
          color: var(--sullivan-gold);
          border: 1px dashed rgba(255, 215, 100, 0.2);
          transition: all 0.2s;
        }
        .conv-new-btn:hover {
          background: rgba(255, 215, 100, 0.06);
          border-color: rgba(255, 215, 100, 0.4);
        }

        /* Three-dot menu on conversation items */
        .conv-item-row {
          display: flex;
          align-items: center;
          gap: 0;
          width: 100%;
        }
        .conv-item-content {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          cursor: pointer;
        }
        .conv-menu-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          font-size: 16px;
          color: var(--text-faint);
          opacity: 1;
          transition: opacity 0.2s, background 0.2s;
          flex-shrink: 0;
        }
        @media (hover: hover) {
          .conv-menu-btn {
            opacity: 0;
          }
          .conv-item:hover .conv-menu-btn {
            opacity: 0.6;
          }
        }
        .conv-menu-btn:hover {
          opacity: 1 !important;
          background: var(--glass-hover);
        }
        .conv-dropdown {
          position: absolute;
          right: 16px;
          margin-top: 4px;
          background: rgba(20, 24, 50, 0.98);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 4px;
          z-index: 20;
          min-width: 160px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
        .conv-dropdown-item {
          width: 100%;
          text-align: left;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 14px;
          color: #f87171;
          transition: background 0.15s;
          cursor: pointer;
        }
        .conv-dropdown-item:hover {
          background: rgba(248, 113, 113, 0.1);
        }

        /* Message context menu */
        .msg-context-menu {
          position: fixed;
          background: rgba(20, 24, 50, 0.98);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 4px;
          z-index: 30;
          min-width: 140px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
        .msg-context-item {
          width: 100%;
          text-align: left;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 14px;
          color: #f87171;
          transition: background 0.15s;
          cursor: pointer;
        }
        .msg-context-item:hover {
          background: rgba(248, 113, 113, 0.1);
        }

        /* Confirm dialog overlay */
        .confirm-overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .confirm-dialog {
          background: rgba(20, 24, 50, 0.98);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 24px;
          max-width: 320px;
          width: 100%;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .confirm-title {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 500;
          color: var(--text-parchment);
          margin-bottom: 8px;
        }
        .confirm-body {
          font-size: 14px;
          color: var(--text-faint);
          line-height: 1.5;
          margin-bottom: 20px;
        }
        .confirm-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .confirm-cancel {
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          color: var(--text-parchment);
          background: var(--glass);
          border: 1px solid var(--border-subtle);
          transition: background 0.15s;
          cursor: pointer;
        }
        .confirm-cancel:hover {
          background: var(--glass-hover);
        }
        .confirm-delete {
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          color: #fff;
          background: #dc2626;
          border: none;
          transition: background 0.15s;
          cursor: pointer;
        }
        .confirm-delete:hover {
          background: #b91c1c;
        }
      `}</style>

      <div className="chat-screen" style={{ ['--accent' as string]: displayCompanion.accentColor }}>
        {/* Header */}
        <div className="chat-header">
          <button className="chat-back" onClick={onBack}>←</button>
          <div className="chat-header-info">
            <div className="chat-companion-name">
              {displayCompanion.icon === 'sun' ? '☀️' : '🌙'} {displayCompanion.name}
            </div>
            <div className="chat-companion-status">{displayCompanion.tagline}</div>
          </div>
          <div className="chat-header-actions">
            <select
              value={chatProvider}
              onChange={async (e) => {
                const val = e.target.value;
                setChatProvider(val);
                const { data: existing } = await supabase.from('user_settings' as any).select('id').limit(1).single();
                if (existing) {
                  await supabase.from('user_settings' as any).update({ chat_provider: val }).eq('id', (existing as any).id);
                }
              }}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: 'inherit', fontSize: '11px', padding: '4px 8px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="xai">Grok</option>
              <option value="kimi">Kimi</option>
              <option value="gemini">Gemini</option>
            </select>
            <button
              className="header-btn"
              onClick={() => setShowConvList(true)}
              title="Conversations"
            >
              ☰
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-messages">
          {messages.length === 0 && !isTyping && (
            <div className="empty-chat">
              <div className="empty-chat-text">
                {displayCompanion.greeting || `${displayCompanion.name} is here.\nSay something.`}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={msg.id}>
              {shouldShowTimestamp(msg, messages[i - 1]) && (
                <div className="timestamp-divider">
                  {formatTimestamp(msg.created_at)}
                </div>
              )}
              <div className={`message-row ${msg.role}`}>
                <div className="message-col">
                  <div
                    className={`message-bubble ${msg.role} ${(msg.media_type === 'voice') ? 'voice-note' : ''} ${msg.message_type === 'dream' ? 'dream' : ''}`}
                    onContextMenu={(e) => handleMsgContextMenu(e, msg.id)}
                    onTouchStart={() => handleMsgTouchStart(msg.id)}
                    onTouchEnd={handleMsgTouchEnd}
                    onTouchMove={handleMsgTouchEnd}
                  >
                    {msg.message_type === 'dream' && (
                      <div className="dream-label">☽ dream</div>
                    )}
                    {(msg.media_type === 'voice') ? (
                      <VoiceNoteBubble msg={msg} speak={speak} stop={stop} speakingMsgId={speakingMsgId} />
                    ) : (
                      <>
                        {/* User-uploaded attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div style={{ marginBottom: msg.content ? '6px' : 0 }}>
                            {msg.attachments.filter(a => a.type === 'image').map((att) => (
                              <img
                                key={att.id}
                                src={att.url}
                                alt={att.name}
                                style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '8px', objectFit: 'contain', display: 'block', marginBottom: '4px', cursor: 'pointer' }}
                                loading="lazy"
                                onClick={() => window.open(att.url, '_blank')}
                              />
                            ))}
                            {msg.attachments.filter(a => a.type === 'document').map((att) => (
                              <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', marginBottom: '4px', fontSize: '12px', opacity: 0.7 }}>
                                📄 {att.name}
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.content}
                        {msg.image_url && (
                          <div style={{ marginTop: '8px' }}>
                            <img
                              src={msg.image_url}
                              alt="Sullivan sent an image"
                              style={{
                                maxWidth: '100%',
                                borderRadius: '8px',
                                maxHeight: '400px',
                                objectFit: 'contain',
                              }}
                              loading="lazy"
                            />
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                              <button
                                style={{ fontSize: '11px', opacity: 0.5, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
                                onClick={() => {
                                  const a = document.createElement('a');
                                  a.href = msg.image_url!;
                                  a.download = `sullivan-${Date.now()}.png`;
                                  a.target = '_blank';
                                  a.click();
                                }}
                              >
                                Save
                              </button>
                              {msg.image_provider && (
                                <span style={{ fontSize: '10px', opacity: 0.3 }}>
                                  via {msg.image_provider === 'dalle' ? 'DALL-E' : 'Gemini'}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {/* Reactions display */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className={`reactions-row ${msg.role}`}>
                      {msg.reactions.map((r, ri) => (
                        <span
                          key={ri}
                          className={`reaction-pill ${r.by}`}
                          onClick={() => r.by === 'user' ? toggleReaction(msg.id, r.emoji) : undefined}
                        >
                          {r.emoji}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={`message-meta ${msg.role}`}>
                    <span className="message-time">{formatMessageTime(msg.created_at)}</span>
                    {msg.role === 'assistant' && msg.chat_provider && (
                      <span style={{ fontSize: '10px', opacity: 0.25 }}>
                        {msg.chat_provider === 'xai' ? 'grok' : msg.chat_provider === 'kimi' ? 'kimi' : msg.chat_provider === 'gemini' ? 'gemini' : msg.chat_provider}
                      </span>
                    )}
                    {msg.role === 'assistant' && !msg.id.startsWith('error-') && msg.media_type !== 'voice' && (
                      <button
                        className="react-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          speakingMsgId === msg.id ? stop() : speak(msg.content, msg.id);
                        }}
                        title={speakingMsgId === msg.id ? 'Stop' : 'Read aloud'}
                      >
                        {speakingMsgId === msg.id ? '⏹' : '🔊'}
                      </button>
                    )}
                    {!msg.id.startsWith('temp-') && !msg.id.startsWith('error-') && (
                      <button
                        className="react-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id);
                        }}
                      >
                        +
                      </button>
                    )}
                  </div>
                  {/* Emoji picker */}
                  {reactionPickerMsgId === msg.id && (
                    <div className={`emoji-picker ${msg.role}`}>
                      {allEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          className={`emoji-btn ${msg.reactions?.some((r) => r.emoji === emoji && r.by === 'user') ? 'active' : ''}`}
                          onClick={() => toggleReaction(msg.id, emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="typing-indicator">
              <div className="typing-star" />
              <div className="typing-star" />
              <div className="typing-star" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Hidden file inputs */}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => processFile(e.target.files?.[0])} />
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => processFile(e.target.files?.[0])} />
        <input ref={fileInputRef} type="file" accept=".txt,.md,.json,.csv,.pdf,image/*" style={{ display: 'none' }} onChange={(e) => processFile(e.target.files?.[0])} />

        {/* Attachment preview strip */}
        {attachments.length > 0 && (
          <div
            style={{
              position: 'relative',
              padding: '8px 16px 0',
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              flexShrink: 0,
              background: 'rgba(10, 14, 39, 0.8)',
              backdropFilter: 'blur(12px)',
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
            onDragStart={(e) => e.preventDefault()}
          >
            {attachments.map((att) => (
              <div
                key={att.id}
                draggable={false}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '12px' }}
              >
                {att.type === 'image' ? (
                  <img
                    src={att.url}
                    alt=""
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      objectFit: 'cover',
                      pointerEvents: 'none',
                      WebkitTouchCallout: 'none',
                      ...({ WebkitUserDrag: 'none' } as React.CSSProperties),
                    }}
                  />
                ) : (
                  <span>📄</span>
                )}
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 }}>{att.name}</span>
                <button
                  onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: '0 2px', fontSize: '14px' }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="chat-input-area">
          {isRecording ? (
            <div className="recording-bar">
              <div className="rec-dot" />
              <span className="rec-text">Recording... {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}</span>
              <button className="rec-cancel" onClick={cancelRecording}>Cancel</button>
            </div>
          ) : (
            <>
            <div style={{ position: 'relative' }}>
              <button
                className="send-btn"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                title="Attach file"
                style={{ fontSize: '16px', opacity: 0.5 }}
              >
                +
              </button>
              {showAttachMenu && (
                <div style={{ position: 'absolute', bottom: '44px', left: 0, background: 'rgba(20,24,50,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px', zIndex: 10, backdropFilter: 'blur(12px)', minWidth: '140px' }}>
                  <button onClick={() => { cameraInputRef.current?.click(); setShowAttachMenu(false); }} style={{ background: 'none', border: 'none', color: 'inherit', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', borderRadius: '8px', fontSize: '13px' }}>📷 Camera</button>
                  <button onClick={() => { imageInputRef.current?.click(); setShowAttachMenu(false); }} style={{ background: 'none', border: 'none', color: 'inherit', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', borderRadius: '8px', fontSize: '13px' }}>🖼️ Photo</button>
                  <button onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }} style={{ background: 'none', border: 'none', color: 'inherit', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', borderRadius: '8px', fontSize: '13px' }}>📄 Document</button>
                </div>
              )}
            </div>
            <textarea
              ref={inputRef}
              className="chat-textarea"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 200) + 'px';
              }}
              placeholder={displayCompanion.name}
              rows={1}
            />
            </>
          )}
          <button
            className={`mic-btn ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? stopRecordingAndSend : startRecording}
            title={isRecording ? 'Stop & send' : 'Voice note'}
          >
            {isRecording ? '⏹' : '🎤'}
          </button>
          {!isRecording && (
            <button className="send-btn" onClick={sendMessage} title="Send">
              ➤
            </button>
          )}
        </div>

        {/* Conversation list overlay */}
        {showConvList && (
          <div className="conv-overlay">
            <div className="conv-overlay-header">
              <div className="conv-overlay-title">Conversations</div>
              <button className="conv-close" onClick={() => setShowConvList(false)}>×</button>
            </div>
            <div className="conv-list">
              <button className="conv-new-btn" onClick={createNewConversation}>
                ✦ new conversation
              </button>
              {allConversations.map((c) => (
                <div
                  key={c.id}
                  className={`conv-item ${conversation?.id === c.id ? 'active' : ''}`}
                  style={{ position: 'relative' }}
                >
                  <div className="conv-item-row">
                    <div className="conv-item-content" onClick={() => switchConversation(c)}>
                      <span className="conv-item-title">{formatConvTitle(c)}</span>
                      <span className="conv-item-date">
                        {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <button
                      className="conv-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConvMenuId(convMenuId === c.id ? null : c.id);
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {convMenuId === c.id && (
                    <div className="conv-dropdown" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="conv-dropdown-item"
                        onClick={() => {
                          setConfirmDeleteConvId(c.id);
                          setConvMenuId(null);
                        }}
                      >
                        Delete conversation
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Message context menu (right-click / long-press) */}
      {msgContextMenu && (
        <div
          className="msg-context-menu"
          style={
            msgContextMenu.x === 0
              ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
              : { top: msgContextMenu.y, left: Math.min(msgContextMenu.x, window.innerWidth - 160) }
          }
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="msg-context-item"
            onClick={() => {
              setConfirmDeleteMsgId(msgContextMenu.msgId);
              setMsgContextMenu(null);
            }}
          >
            Delete message
          </button>
        </div>
      )}

      {/* Confirm dialog: delete conversation */}
      {confirmDeleteConvId && (
        <div className="confirm-overlay" onClick={() => setConfirmDeleteConvId(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Delete conversation</div>
            <div className="confirm-body">Delete this conversation? This can't be undone.</div>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setConfirmDeleteConvId(null)}>Cancel</button>
              <button className="confirm-delete" onClick={() => deleteConversation(confirmDeleteConvId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog: delete message */}
      {confirmDeleteMsgId && (
        <div className="confirm-overlay" onClick={() => setConfirmDeleteMsgId(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Delete message</div>
            <div className="confirm-body">Delete this message? This can't be undone.</div>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setConfirmDeleteMsgId(null)}>Cancel</button>
              <button className="confirm-delete" onClick={() => deleteMessage(confirmDeleteMsgId)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

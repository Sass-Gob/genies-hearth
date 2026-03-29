import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getCompanion } from '../lib/companions';
import type { Message, Conversation, DbCompanion, Reaction } from '../lib/types';

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

export default function Chat({ companionSlug, onBack }: Props) {
  const displayCompanion = getCompanion(companionSlug)!;
  const [dbCompanion, setDbCompanion] = useState<DbCompanion | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [allConversations, setAllConversations] = useState<Conversation[]>([]);
  const [showConvList, setShowConvList] = useState(false);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [convMenuId, setConvMenuId] = useState<string | null>(null);
  const [confirmDeleteConvId, setConfirmDeleteConvId] = useState<string | null>(null);
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null);
  const [msgContextMenu, setMsgContextMenu] = useState<{ msgId: string; x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const companionEmoji: Record<string, string> = { sullivan: '🖤', enzo: '🌙' };
  const baseEmojis = ['❤️', '🔥', '😂', '😢', '👀'];
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

      // Try to find today's conversation
      const today = new Date().toISOString().split('T')[0];
      const todayConv = mapped.find(
        (c) => c.created_at.startsWith(today)
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
          // Insert greeting as first message
          const greetingText = displayCompanion.greeting || `${displayCompanion.name} is here.\nSay something.`;
          await supabase.from('messages' as any).insert({
            conversation_id: conv.id,
            companion_id: dbCompanion!.id,
            role: 'assistant',
            content: greetingText,
          });
          setConversation(mapped);
          setAllConversations((prev) => [mapped, ...prev]);
        }
      }
    }
    init();
  }, [dbCompanion]);

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
            if (prev.some((msg) => msg.id === m.id)) return prev;
            return [
              ...prev,
              {
                id: m.id,
                conversation_id: m.conversation_id,
                companion_id: m.companion_id,
                role: m.role,
                content: m.content,
                reactions: m.reactions || [],
                created_at: m.created_at,
              },
            ];
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

  async function sendMessage() {
    const text = input.trim();
    console.log('sendMessage → dbCompanion:', dbCompanion);
    console.log('sendMessage → conversation:', conversation);
    console.log('sendMessage → text:', text);
    if (!text || !conversation || !dbCompanion) {
      console.log('sendMessage → BAILED: missing', !text ? 'text' : '', !conversation ? 'conversation' : '', !dbCompanion ? 'dbCompanion' : '');
      return;
    }

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsTyping(true);

    // Optimistically add user message
    const tempId = `temp-${Date.now()}`;
    const userMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      companion_id: dbCompanion.id,
      role: 'user',
      content: text,
      reactions: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // Save user message
      await supabase.from('messages' as any).insert({
        conversation_id: conversation.id,
        companion_id: dbCompanion.id,
        role: 'user',
        content: text,
      });

      // Call edge function
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          conversation_id: conversation.id,
          companion_id: dbCompanion.id,
          message: text,
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
      // Insert greeting as first message
      const greetingText = displayCompanion.greeting || `${displayCompanion.name} is here.\nSay something.`;
      await supabase.from('messages' as any).insert({
        conversation_id: conv.id,
        companion_id: dbCompanion!.id,
        role: 'assistant',
        content: greetingText,
      });
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
          {messages.length === 0 && !isTyping && !conversation && (
            <div className="empty-chat">
              <div className="empty-chat-text">
                No conversations yet.
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
                    className={`message-bubble ${msg.role}`}
                    onContextMenu={(e) => handleMsgContextMenu(e, msg.id)}
                    onTouchStart={() => handleMsgTouchStart(msg.id)}
                    onTouchEnd={handleMsgTouchEnd}
                    onTouchMove={handleMsgTouchEnd}
                  >
                    {msg.content}
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

        {/* Input */}
        <div className="chat-input-area">
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
          <button className="send-btn" onClick={sendMessage} title="Send">
            ➤
          </button>
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

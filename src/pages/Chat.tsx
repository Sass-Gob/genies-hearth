import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getCompanion } from '../lib/companions';
import type { Message, Conversation, DbCompanion } from '../lib/types';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

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
                created_at: m.created_at,
              },
            ];
          });
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
    setIsTyping(true);

    // Optimistically add user message
    const tempId = `temp-${Date.now()}`;
    const userMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      companion_id: dbCompanion.id,
      role: 'user',
      content: text,
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
            created_at: new Date().toISOString(),
          },
        ]);
        return;
      }

      // Add assistant message if realtime hasn't already
      if (data?.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

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
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 20px;
          padding: 8px 16px;
          resize: none;
          max-height: 120px;
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
          {messages.length === 0 && !isTyping && (
            <div className="empty-chat">
              <div className="empty-chat-text">
                {displayCompanion.name} is here.<br />
                Say something.
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
                <div className={`message-bubble ${msg.role}`}>
                  {msg.content}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
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
                  onClick={() => switchConversation(c)}
                >
                  <span className="conv-item-title">{formatConvTitle(c)}</span>
                  <span className="conv-item-date">
                    {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

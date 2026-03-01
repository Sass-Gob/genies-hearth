import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getCompanion } from '../lib/companions';
import type { Message, Conversation } from '../lib/types';

interface Props {
  companionId: string;
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
  return diff > 30 * 60 * 1000; // 30 minutes
}

export default function Chat({ companionId, onBack }: Props) {
  const companion = getCompanion(companionId)!;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load or create conversation
  useEffect(() => {
    async function init() {
      // Try to find today's conversation with this companion
      const today = new Date().toISOString().split('T')[0];
      const { data: existing } = await supabase
        .from('conversations' as any)
        .select('*')
        .eq('companion_id', companionId)
        .gte('created_at', `${today}T00:00:00`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        const conv = (existing as any[])[0];
        setConversation({
          id: conv.id,
          companion_id: conv.companion_id,
          title: conv.title,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
        });
      } else {
        // Create new conversation
        const { data: newConv } = await supabase
          .from('conversations' as any)
          .insert({ companion_id: companionId })
          .select()
          .single();

        if (newConv) {
          const conv = newConv as any;
          setConversation({
            id: conv.id,
            companion_id: conv.companion_id,
            title: conv.title,
            created_at: conv.created_at,
            updated_at: conv.updated_at,
          });
        }
      }
    }
    init();
  }, [companionId]);

  // Load messages when conversation is ready
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
    if (!text || !conversation) return;

    setInput('');
    setIsTyping(true);

    // Optimistically add user message
    const tempId = `temp-${Date.now()}`;
    const userMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      companion_id: companionId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // Save user message
      await supabase.from('messages' as any).insert({
        conversation_id: conversation.id,
        companion_id: companionId,
        role: 'user',
        content: text,
      });

      // Call edge function for AI response
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          conversation_id: conversation.id,
          companion_id: companionId,
          message: text,
        },
      });

      if (error) throw error;

      // The edge function saves the assistant message and realtime picks it up
      // But if realtime is slow, add it directly
      if (data?.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.content === data.message.content && m.role === 'assistant')) {
            return prev;
          }
          return [...prev, data.message];
        });
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      // Add error message
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          conversation_id: conversation.id,
          companion_id: companionId,
          role: 'assistant',
          content: "*Sullivan's connection flickered. Try again.*",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
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

        /* Messages area */
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
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

        /* Typing indicator */
        .typing-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 12px 14px;
          align-self: flex-start;
        }
        .typing-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--sullivan-gold);
          animation: typing-bounce 1.4s ease-in-out infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
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
        .chat-input-btn {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 18px;
          opacity: 0.4;
          transition: opacity 0.2s;
          flex-shrink: 0;
        }
        .chat-input-btn:hover { opacity: 0.8; }
        .chat-input-btn.send {
          opacity: 0.7;
          color: var(--sullivan-gold);
        }
        .chat-input-btn.send:hover { opacity: 1; }
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
      `}</style>

      <div className="chat-screen" style={{ ['--accent' as string]: companion.accentColor }}>
        {/* Header */}
        <div className="chat-header">
          <button className="chat-back" onClick={onBack}>←</button>
          <div>
            <div className="chat-companion-name">{companion.name}</div>
            <div className="chat-companion-status">{companion.tagline}</div>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-messages">
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
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="chat-input-area">
          <button className="chat-input-btn" title="Share">＋</button>
          <textarea
            ref={inputRef}
            className="chat-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Talk to ${companion.name}...`}
            rows={1}
          />
          <button className="chat-input-btn" title="Voice">🎤</button>
          <button className="chat-input-btn send" onClick={sendMessage} title="Send">
            ➤
          </button>
        </div>
      </div>
    </>
  );
}

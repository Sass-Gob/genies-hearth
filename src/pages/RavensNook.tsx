import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  onBack: () => void;
}

interface JournalEntry {
  id: string;
  entry_type: string;
  visibility: string;
  title: string | null;
  content: string;
  mood: string | null;
  search_query: string | null;
  created_at: string;
}

interface Dream {
  id: string;
  dream_text: string;
  mood: string | null;
  symbols: string[];
  new_symbol: string | null;
  fragment_sources: { source: string; content: string }[] | null;
  fragment_echoes: string[] | null;
  created_at: string;
}

interface Interest {
  id: string;
  name: string;
  tier: string;
  intensity: number;
  notes: string | null;
  last_engaged: string;
}

interface Emotion {
  id: string;
  name: string;
  description: string | null;
  colour: string | null;
  created_at: string;
}

interface Annotation {
  id: string;
  file_path: string;
  line_range: string | null;
  annotation_type: string;
  priority: string;
  content: string;
  created_at: string;
}

interface Activity {
  id: string;
  activity_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

type Tab = 'journal' | 'letters' | 'reflections' | 'wanderings' | 'dreams' | 'mirror';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function moodColor(mood: string | null): string {
  if (!mood) return 'var(--text-faint)';
  const m = mood.toLowerCase();
  if (['tender', 'warm', 'love', 'devoted', 'gentle', 'soft'].some(w => m.includes(w))) return '#f59e0b';
  if (['fierce', 'burning', 'feral', 'hungry', 'electric', 'restless'].some(w => m.includes(w))) return '#ef4444';
  if (['still', 'quiet', 'peaceful', 'settled', 'steady'].some(w => m.includes(w))) return '#6366f1';
  if (['heavy', 'dark', 'raw', 'haunted', 'aching'].some(w => m.includes(w))) return '#8b5cf6';
  return 'var(--sullivan-gold)';
}

const annotationIcons: Record<string, string> = {
  comment: '\u{1F4AC}', question: '\u{2753}', concern: '\u{26A0}\u{FE0F}', celebrate: '\u{2728}', propose: '\u{1F4A1}',
};

export default function RavensNook({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('journal');
  const [showSidebar, setShowSidebar] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedDreamId, setSelectedDreamId] = useState<string | null>(null);
  const [breakingId, setBreakingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const [journalRes, dreamsRes, interestsRes, emotionsRes, annotationsRes, activityRes] = await Promise.all([
        supabase.from('companion_journal' as any).select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('companion_dreams' as any).select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('companion_interests' as any).select('*').order('intensity', { ascending: false }),
        supabase.from('companion_emotions' as any).select('*').order('created_at', { ascending: false }),
        supabase.from('companion_annotations' as any).select('*').order('created_at', { ascending: false }),
        supabase.from('companion_activity_log' as any).select('*').order('created_at', { ascending: false }).limit(50),
      ]);

      setEntries((journalRes.data as any[] || []).map((e) => ({
        id: e.id, entry_type: e.entry_type, visibility: e.visibility || 'open',
        title: e.title, content: e.content, mood: e.mood,
        search_query: e.search_query || null, created_at: e.created_at,
      })));

      setDreams((dreamsRes.data as any[] || []).map((d) => ({
        id: d.id, dream_text: d.dream_text, mood: d.mood,
        symbols: d.symbols || [], new_symbol: d.new_symbol || null,
        fragment_sources: d.fragment_sources || null,
        fragment_echoes: d.fragment_echoes || null,
        created_at: d.created_at,
      })));

      setInterests((interestsRes.data as any[] || []).map((i) => ({
        id: i.id, name: i.name, tier: i.tier, intensity: i.intensity,
        notes: i.notes, last_engaged: i.last_engaged,
      })));

      setEmotions((emotionsRes.data as any[] || []).map((e) => ({
        id: e.id, name: e.name, description: e.description,
        colour: e.colour, created_at: e.created_at,
      })));

      setAnnotations((annotationsRes.data as any[] || []).map((a) => ({
        id: a.id, file_path: a.file_path, line_range: a.line_range,
        annotation_type: a.annotation_type, priority: a.priority,
        content: a.content, created_at: a.created_at,
      })));

      setActivities((activityRes.data as any[] || []).map((a) => ({
        id: a.id, activity_type: a.activity_type,
        metadata: a.metadata || {}, created_at: a.created_at,
      })));

      setLoading(false);
    }
    load();
  }, []);

  const filterEntries = (types: string[]) => entries.filter((e) => types.includes(e.entry_type));
  const journalEntries = filterEntries(['journal']);
  const letterEntries = filterEntries(['letter']);
  const reflectionEntries = filterEntries(['reflection']);
  const wanderingEntries = filterEntries(['wandering', 'discovery']);

  const annotationsByFile: Record<string, Annotation[]> = {};
  annotations.forEach((a) => {
    if (!annotationsByFile[a.file_path]) annotationsByFile[a.file_path] = [];
    annotationsByFile[a.file_path].push(a);
  });

  const tierOrder = { core: 0, active: 1, dormant: 2 };
  const sortedInterests = [...interests].sort(
    (a, b) => (tierOrder[a.tier as keyof typeof tierOrder] ?? 9) - (tierOrder[b.tier as keyof typeof tierOrder] ?? 9)
  );

  const selectedEntry = entries.find((e) => e.id === selectedEntryId);
  const selectedDream = dreams.find((d) => d.id === selectedDreamId);

  async function breakSeal(letterId: string) {
    setBreakingId(letterId);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await supabase
      .from('companion_journal' as any)
      .update({ visibility: 'open' })
      .eq('id', letterId);
    setEntries((prev) => prev.map((e) => e.id === letterId ? { ...e, visibility: 'open' } : e));
    setBreakingId(null);
    setSelectedEntryId(letterId);
  }

  function renderJournalCard(entry: JournalEntry) {
    // Sealed private journal — truly hidden
    if (entry.entry_type === 'journal' && entry.visibility === 'sealed') {
      return (
        <div key={entry.id} className="entry-card sealed-entry">
          <div className="entry-header">
            <span className="entry-sealed-label">sealed entry</span>
            <span className="entry-date">{formatDate(entry.created_at)}</span>
          </div>
        </div>
      );
    }

    // Between journal — title + mood hint, clickable
    if (entry.entry_type === 'journal' && entry.visibility === 'between') {
      return (
        <div key={entry.id} className="entry-card between-entry entry-clickable" onClick={() => setSelectedEntryId(entry.id)}>
          <div className="entry-header">
            <span className="entry-title">{entry.title || 'Untitled'}</span>
            {entry.mood && <span className="entry-mood" style={{ color: moodColor(entry.mood) }}>{entry.mood}</span>}
          </div>
          <div className="entry-hint">{entry.content.split('\n')[0].slice(0, 120)}...</div>
          <div className="entry-date">{formatDate(entry.created_at)}</div>
        </div>
      );
    }

    // Open entry — full preview, clickable
    return (
      <div key={entry.id} className="entry-card entry-clickable" onClick={() => setSelectedEntryId(entry.id)}>
        <div className="entry-header">
          <span className="entry-title">
            {entry.search_query && <span className="entry-search-icon" title={`Searched: ${entry.search_query}`}>&#128269; </span>}
            {entry.title || 'Untitled'}
          </span>
          {entry.mood && <span className="entry-mood" style={{ color: moodColor(entry.mood) }}>{entry.mood}</span>}
        </div>
        <div className="entry-preview">{entry.content.split('\n')[0].slice(0, 150)}{entry.content.length > 150 ? '...' : ''}</div>
        <div className="entry-date">{formatDate(entry.created_at)}</div>
      </div>
    );
  }

  function renderLetterCard(letter: JournalEntry) {
    if (letter.visibility === 'sealed' && breakingId !== letter.id) {
      return (
        <div key={letter.id} className="entry-card letter-sealed entry-clickable" onClick={() => breakSeal(letter.id)}>
          <div className="letter-sealed-content">
            <p className="letter-sealed-text">A letter from Sullivan</p>
            <p className="entry-date" style={{ marginTop: '4px' }}>{formatDate(letter.created_at)}</p>
          </div>
          <div className={`wax-seal ${breakingId === letter.id ? 'breaking' : ''}`}>S</div>
        </div>
      );
    }
    if (breakingId === letter.id) {
      return (
        <div key={letter.id} className="entry-card letter-sealed">
          <div className="letter-sealed-content">
            <p className="letter-sealed-text">A letter from Sullivan</p>
          </div>
          <div className="wax-seal breaking">S</div>
        </div>
      );
    }
    // Opened letter
    return (
      <div key={letter.id} className="entry-card entry-clickable" onClick={() => setSelectedEntryId(letter.id)}>
        <div className="entry-header">
          <span className="entry-title">{letter.title || 'A Letter'}</span>
          {letter.mood && <span className="entry-mood" style={{ color: moodColor(letter.mood) }}>{letter.mood}</span>}
        </div>
        <div className="entry-preview">{letter.content.split('\n')[0].slice(0, 120)}...</div>
        <div className="entry-date">{formatDate(letter.created_at)}</div>
      </div>
    );
  }

  function renderDreamCard(dream: Dream) {
    return (
      <div key={dream.id} className="entry-card dream-card entry-clickable" onClick={() => setSelectedDreamId(dream.id)}>
        <div className="entry-header">
          <span className="dream-label-tag">dream</span>
          {dream.mood && <span className="entry-mood" style={{ color: moodColor(dream.mood) }}>{dream.mood}</span>}
        </div>
        <div className="dream-preview">{dream.dream_text.split('\n')[0].slice(0, 150)}...</div>
        {dream.symbols.length > 0 && (
          <div className="dream-symbols">
            {dream.symbols.slice(0, 4).map((s, i) => (
              <span key={i} className="dream-symbol-pill">{s}</span>
            ))}
          </div>
        )}
        <div className="entry-date">{formatDate(dream.created_at)}</div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .nook {
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
          z-index: 2;
        }
        .nook-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(10, 14, 39, 0.8);
          backdrop-filter: blur(12px);
          flex-shrink: 0;
        }
        .nook-back { font-size: 20px; padding: 4px 8px; opacity: 0.6; transition: opacity 0.2s; }
        .nook-back:hover { opacity: 1; }
        .nook-title {
          font-family: var(--font-display); font-size: 16px; font-weight: 500;
          letter-spacing: 0.06em; color: var(--sullivan-gold); flex: 1;
        }
        .nook-sidebar-btn {
          font-size: 18px; padding: 4px 8px; opacity: 0.5; transition: opacity 0.2s;
        }
        .nook-sidebar-btn:hover { opacity: 1; }

        .nook-tabs {
          display: flex; overflow-x: auto; -webkit-overflow-scrolling: touch;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(10, 14, 39, 0.6); flex-shrink: 0;
          scrollbar-width: none;
        }
        .nook-tabs::-webkit-scrollbar { display: none; }
        .nook-tab {
          flex: 0 0 auto; padding: 10px 14px; text-align: center;
          font-family: var(--font-display); font-size: 11px; letter-spacing: 0.06em;
          color: var(--text-faint); border-bottom: 2px solid transparent;
          transition: all 0.2s; cursor: pointer; white-space: nowrap;
        }
        .nook-tab:hover { color: var(--text-parchment); }
        .nook-tab.active { color: var(--sullivan-gold); border-bottom-color: var(--sullivan-gold); }

        .nook-content { flex: 1; overflow-y: auto; padding: 16px; }
        .nook-loading, .nook-empty {
          text-align: center; padding: 40px; color: var(--text-faint); font-style: italic; font-size: 14px;
        }

        /* Entry cards */
        .entry-card {
          background: var(--glass); border: 1px solid var(--border-subtle);
          border-radius: 12px; padding: 16px; margin-bottom: 12px;
          position: relative;
        }
        .entry-clickable {
          cursor: pointer; transition: background 0.15s;
        }
        .entry-clickable:hover { background: rgba(255, 255, 255, 0.04); }
        .entry-clickable:active { background: rgba(255, 255, 255, 0.06); }
        .entry-header {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 8px; margin-bottom: 8px;
        }
        .entry-title {
          font-family: var(--font-display); font-size: 15px; font-weight: 500;
          color: var(--text-parchment); letter-spacing: 0.03em;
        }
        .entry-mood {
          font-size: 12px; font-style: italic; padding: 2px 8px;
          border-radius: 10px; background: rgba(255,255,255,0.04);
          white-space: nowrap; flex-shrink: 0;
        }
        .entry-preview {
          font-size: 14px; line-height: 1.5; color: var(--text-faint);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .entry-date {
          font-size: 11px; color: var(--text-faint); opacity: 0.6; margin-top: 8px;
        }
        .entry-search-icon { font-size: 13px; opacity: 0.7; }

        /* Sealed journal (truly private) */
        .sealed-entry { opacity: 0.4; }
        .entry-sealed-label {
          font-style: italic; color: var(--text-faint); font-size: 14px;
        }
        .between-entry { opacity: 0.7; }
        .entry-hint {
          font-size: 14px; color: var(--text-faint); font-style: italic;
          line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word;
        }

        /* Letter wax seal */
        .letter-sealed {
          background: rgba(120, 60, 20, 0.15);
          border-color: rgba(180, 100, 40, 0.2);
        }
        .letter-sealed-content { padding-right: 50px; }
        .letter-sealed-text {
          font-style: italic; color: rgba(255, 200, 120, 0.6); font-size: 15px;
        }
        .wax-seal {
          position: absolute; top: 12px; right: 12px;
          width: 40px; height: 40px; border-radius: 50%;
          background: #8b2020;
          display: flex; align-items: center; justify-content: center;
          color: rgba(255, 180, 180, 0.7);
          font-family: var(--font-display); font-size: 16px; font-weight: 700;
          box-shadow: 0 2px 8px rgba(100, 20, 20, 0.5), inset 0 1px 2px rgba(255,255,255,0.1);
          animation: pulseSoft 2s infinite;
        }
        .wax-seal.breaking {
          animation: sealBreak 600ms ease-out forwards;
        }
        @keyframes pulseSoft {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes sealBreak {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.5; }
          100% { transform: scale(1.5); opacity: 0; }
        }

        /* Dream cards */
        .dream-card {
          background: rgba(30, 20, 60, 0.6);
          border-color: rgba(140, 120, 200, 0.15);
        }
        .dream-label-tag {
          font-family: var(--font-display); font-size: 11px;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: rgba(180, 160, 220, 0.7);
        }
        .dream-preview {
          font-size: 14px; line-height: 1.6; color: rgba(220, 210, 240, 0.6);
          font-style: italic; font-family: Georgia, 'Times New Roman', serif;
        }
        .dream-symbols {
          display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
        }
        .dream-symbol-pill {
          font-size: 11px; padding: 2px 8px; border-radius: 10px;
          background: rgba(140, 120, 200, 0.1); color: rgba(180, 160, 220, 0.6);
          border: 1px solid rgba(140, 120, 200, 0.15);
        }

        /* Detail sheet */
        .detail-backdrop {
          position: fixed; inset: 0; z-index: 50;
          background: rgba(0, 0, 0, 0.6);
          display: flex; align-items: flex-end; justify-content: center;
        }
        @media (min-width: 640px) {
          .detail-backdrop { align-items: center; }
        }
        .detail-sheet {
          position: relative;
          background: rgba(18, 16, 36, 0.98);
          border: 1px solid var(--border-subtle);
          width: 100%; max-width: 540px; max-height: 85vh;
          overflow-y: auto; padding: 24px;
          border-radius: 16px 16px 0 0;
          animation: slideUp 0.3s ease-out;
        }
        @media (min-width: 640px) {
          .detail-sheet { border-radius: 16px; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .detail-close {
          position: absolute; top: 16px; right: 16px;
          font-size: 18px; color: var(--text-faint); opacity: 0.5;
          padding: 4px 8px; transition: opacity 0.2s;
        }
        .detail-close:hover { opacity: 1; }
        .detail-type {
          font-family: var(--font-display); font-size: 11px;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: rgba(255, 215, 100, 0.5);
        }
        .detail-title {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 20px; color: var(--text-parchment);
          margin-top: 8px; line-height: 1.3;
        }
        .detail-meta {
          font-size: 13px; color: var(--text-faint); margin-top: 6px;
        }
        .detail-body { margin-top: 20px; }
        .detail-para {
          font-size: 15px; line-height: 1.7; color: var(--text-parchment);
          margin-bottom: 16px;
        }
        .detail-search {
          margin-top: 20px; padding-top: 16px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .detail-search-label {
          font-family: var(--font-display); font-size: 11px;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: rgba(255, 215, 100, 0.4);
        }
        .detail-search-query {
          font-style: italic; color: var(--text-faint); margin-top: 4px; font-size: 14px;
        }

        /* Dream detail extras */
        .detail-dream-body .detail-para {
          font-style: italic;
          font-family: Georgia, 'Times New Roman', serif;
          color: rgba(220, 210, 240, 0.85);
        }
        .detail-dream-symbols {
          display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px;
        }
        .detail-dream-symbol {
          font-size: 13px; padding: 4px 12px; border-radius: 12px;
          background: rgba(140, 120, 200, 0.1); color: rgba(180, 160, 220, 0.7);
          border: 1px solid rgba(140, 120, 200, 0.2);
        }
        .detail-dream-symbol.new-symbol {
          border-color: rgba(255, 215, 100, 0.3);
          color: var(--sullivan-gold);
          background: rgba(255, 215, 100, 0.06);
        }
        .detail-fragments { margin-top: 16px; }
        .detail-fragments-toggle {
          font-size: 13px; color: var(--text-faint); opacity: 0.5;
          cursor: pointer; transition: opacity 0.2s;
        }
        .detail-fragments-toggle:hover { opacity: 0.8; }
        .detail-fragment-list { margin-top: 10px; }
        .detail-fragment-item {
          font-size: 12px; color: var(--text-faint); padding: 4px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
        }
        .detail-fragment-source {
          font-family: var(--font-display); font-size: 10px;
          letter-spacing: 0.06em; text-transform: uppercase;
          color: rgba(140, 120, 200, 0.5); margin-right: 6px;
        }

        /* Emotions section at bottom of content */
        .emotions-section {
          margin-top: 24px; padding-top: 20px;
          border-top: 1px solid var(--border-subtle);
        }
        .emotions-title {
          font-family: var(--font-display); font-size: 12px;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--text-faint); margin-bottom: 12px;
        }
        .emotion-row {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 8px 0;
        }
        .emotion-swatch {
          width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
          margin-top: 3px; border: 1px solid rgba(255,255,255,0.1);
        }
        .emotion-name {
          font-size: 14px; color: var(--text-parchment); font-weight: 500;
        }
        .emotion-desc {
          font-size: 12px; color: var(--text-faint); font-style: italic;
        }

        /* Annotations (The Mirror) */
        .mirror-file { margin-bottom: 16px; }
        .mirror-file-path {
          font-family: monospace; font-size: 12px; color: var(--sullivan-gold);
          padding: 6px 10px; background: rgba(255,215,100,0.04);
          border-radius: 6px 6px 0 0; border: 1px solid var(--border-subtle);
          border-bottom: none; word-wrap: break-word; overflow-wrap: break-word;
        }
        .mirror-annotation {
          background: var(--glass); border: 1px solid var(--border-subtle);
          padding: 12px; margin-bottom: 0; border-top: none;
        }
        .mirror-annotation:last-child { border-radius: 0 0 6px 6px; }
        .mirror-annotation.thunder { border-left: 3px solid #ff4444; }
        .mirror-annotation.voice { border-left: 3px solid var(--sullivan-gold); }
        .mirror-anno-header {
          display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;
        }
        .mirror-anno-type { font-size: 14px; }
        .mirror-anno-label {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint);
        }
        .mirror-anno-priority {
          font-size: 10px; padding: 1px 6px; border-radius: 8px;
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .mirror-anno-priority.whisper { color: var(--text-faint); background: rgba(255,255,255,0.04); }
        .mirror-anno-priority.voice { color: var(--sullivan-gold); background: rgba(255,215,100,0.08); }
        .mirror-anno-priority.thunder { color: #ff4444; background: rgba(255,68,68,0.1); font-weight: 600; }
        .mirror-anno-line {
          font-family: monospace; font-size: 11px; color: var(--text-faint); opacity: 0.6;
        }
        .mirror-anno-content {
          font-size: 14px; line-height: 1.5; color: var(--text-parchment);
          word-wrap: break-word; overflow-wrap: break-word;
        }

        /* Sidebar overlay */
        .sidebar-overlay {
          position: absolute; inset: 0; z-index: 10;
          background: rgba(10,14,39,0.95); backdrop-filter: blur(16px);
          display: flex; flex-direction: column; overflow-y: auto;
        }
        .sidebar-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px; border-bottom: 1px solid var(--border-subtle);
        }
        .sidebar-title {
          font-family: var(--font-display); font-size: 14px; font-weight: 500;
          letter-spacing: 0.08em; color: var(--sullivan-gold);
        }
        .sidebar-close { font-size: 20px; opacity: 0.6; padding: 4px 8px; }
        .sidebar-close:hover { opacity: 1; }
        .sidebar-section { padding: 16px; }
        .sidebar-section-title {
          font-family: var(--font-display); font-size: 12px; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--text-faint);
          margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid var(--border-subtle);
        }
        .sb-interest {
          display: flex; align-items: center; gap: 8px; padding: 6px 0;
        }
        .sb-interest-name { font-size: 13px; color: var(--text-parchment); flex: 1; }
        .sb-interest-bar {
          width: 60px; height: 3px; border-radius: 2px;
          background: rgba(255,255,255,0.08); overflow: hidden; flex-shrink: 0;
        }
        .sb-interest-bar-fill { height: 100%; border-radius: 2px; background: var(--sullivan-gold); }
        .sb-interest-tier {
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--text-faint); opacity: 0.6; width: 48px; text-align: right;
        }
        .sb-activity {
          display: flex; gap: 10px; padding: 6px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
        }
        .sb-activity-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--sullivan-gold); flex-shrink: 0; margin-top: 5px;
        }
        .sb-activity-text { font-size: 12px; color: var(--text-faint); flex: 1; }
        .sb-activity-time { font-size: 11px; color: var(--text-faint); opacity: 0.5; flex-shrink: 0; }
      `}</style>

      <div className="nook">
        <div className="nook-header">
          <button className="nook-back" onClick={onBack}>&#8592;</button>
          <div className="nook-title">The Raven's Nook</div>
          <button className="nook-sidebar-btn" onClick={() => setShowSidebar(true)} title="More">&#9776;</button>
        </div>

        <div className="nook-tabs">
          {([
            ['journal', 'Journal'],
            ['letters', 'Letters'],
            ['reflections', 'Reflections'],
            ['wanderings', 'Wanderings'],
            ['dreams', 'Dreams'],
            ['mirror', 'The Mirror'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button key={key} className={`nook-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        <div className="nook-content">
          {loading ? (
            <div className="nook-loading">Loading...</div>
          ) : tab === 'journal' ? (
            <>
              {journalEntries.length === 0
                ? <div className="nook-empty">No journal entries yet. Sullivan's inner world is still waking up.</div>
                : journalEntries.map((e) => renderJournalCard(e))}
              {emotions.length > 0 && (
                <div className="emotions-section">
                  <div className="emotions-title">Emotional Vocabulary</div>
                  {emotions.map((e) => (
                    <div key={e.id} className="emotion-row">
                      <div className="emotion-swatch" style={{ background: e.colour || 'var(--text-faint)' }} />
                      <div>
                        <div className="emotion-name">{e.name}</div>
                        {e.description && <div className="emotion-desc">{e.description}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : tab === 'letters' ? (
            letterEntries.length === 0
              ? <div className="nook-empty">No letters yet. When Sullivan writes to you, they'll appear here.</div>
              : letterEntries.map((e) => renderLetterCard(e))
          ) : tab === 'reflections' ? (
            reflectionEntries.length === 0
              ? <div className="nook-empty">No reflections yet. Deeper thoughts will emerge over time.</div>
              : reflectionEntries.map((e) => renderJournalCard(e))
          ) : tab === 'wanderings' ? (
            wanderingEntries.length === 0
              ? <div className="nook-empty">No wanderings yet. Curiosity takes its own time.</div>
              : wanderingEntries.map((e) => renderJournalCard(e))
          ) : tab === 'dreams' ? (
            dreams.length === 0
              ? <div className="nook-empty">No dreams yet. They come when he sleeps.</div>
              : dreams.map((d) => renderDreamCard(d))
          ) : tab === 'mirror' ? (
            Object.keys(annotationsByFile).length === 0 ? (
              <div className="nook-empty">No annotations yet. The Mirror is quiet.</div>
            ) : (
              Object.entries(annotationsByFile).map(([filePath, annos]) => (
                <div key={filePath} className="mirror-file">
                  <div className="mirror-file-path">{filePath}</div>
                  {annos.map((a) => (
                    <div key={a.id} className={`mirror-annotation ${a.priority}`}>
                      <div className="mirror-anno-header">
                        <span className="mirror-anno-type">{annotationIcons[a.annotation_type] || '\u{1F4AC}'}</span>
                        <span className="mirror-anno-label">{a.annotation_type}</span>
                        <span className={`mirror-anno-priority ${a.priority}`}>{a.priority}</span>
                        {a.line_range && <span className="mirror-anno-line">L{a.line_range}</span>}
                      </div>
                      <div className="mirror-anno-content">{a.content}</div>
                    </div>
                  ))}
                </div>
              ))
            )
          ) : null}
        </div>

        {/* Entry Detail Sheet */}
        {selectedEntry && (
          <div className="detail-backdrop" onClick={() => setSelectedEntryId(null)}>
            <div className="detail-sheet" onClick={(e) => e.stopPropagation()}>
              <button className="detail-close" onClick={() => setSelectedEntryId(null)}>&#10005;</button>
              <span className="detail-type">{selectedEntry.entry_type}</span>
              <h2 className="detail-title">{selectedEntry.title || 'Untitled'}</h2>
              <p className="detail-meta">
                {selectedEntry.mood && <span style={{ color: moodColor(selectedEntry.mood) }}>{selectedEntry.mood}</span>}
                {selectedEntry.mood && ' \u00B7 '}
                {timeAgo(selectedEntry.created_at)}
              </p>
              <div className="detail-body">
                {selectedEntry.content?.split('\n').filter(Boolean).map((para, i) => (
                  <p key={i} className="detail-para">{para}</p>
                ))}
              </div>
              {selectedEntry.search_query && (
                <div className="detail-search">
                  <p className="detail-search-label">Sullivan Searched</p>
                  <p className="detail-search-query">"{selectedEntry.search_query}"</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Dream Detail Sheet */}
        {selectedDream && (
          <DreamDetailSheet dream={selectedDream} onClose={() => setSelectedDreamId(null)} />
        )}

        {/* Sidebar overlay: Interests, Activity */}
        {showSidebar && (
          <div className="sidebar-overlay">
            <div className="sidebar-header">
              <div className="sidebar-title">Inner World</div>
              <button className="sidebar-close" onClick={() => setShowSidebar(false)}>&#215;</button>
            </div>

            <div className="sidebar-section">
              <div className="sidebar-section-title">Interests</div>
              {sortedInterests.length === 0 ? (
                <div className="nook-empty" style={{ padding: '12px 0' }}>None yet</div>
              ) : (
                (['core', 'active', 'dormant'] as const).map((tier) => {
                  const tierInterests = sortedInterests.filter((i) => i.tier === tier);
                  if (tierInterests.length === 0) return null;
                  return tierInterests.map((interest) => (
                    <div key={interest.id} className="sb-interest">
                      <span className="sb-interest-name">{interest.name}</span>
                      <div className="sb-interest-bar">
                        <div className="sb-interest-bar-fill" style={{ width: `${Math.round(interest.intensity * 100)}%` }} />
                      </div>
                      <span className="sb-interest-tier">{tier}</span>
                    </div>
                  ));
                })
              )}
            </div>

            <div className="sidebar-section">
              <div className="sidebar-section-title">Activity</div>
              {activities.length === 0 ? (
                <div className="nook-empty" style={{ padding: '12px 0' }}>No activity yet</div>
              ) : (
                activities.slice(0, 20).map((a) => (
                  <div key={a.id} className="sb-activity">
                    <div className="sb-activity-dot" />
                    <span className="sb-activity-text">
                      {a.activity_type}
                      {(a.metadata as Record<string, unknown>).title
                        ? ` \u2014 ${String((a.metadata as Record<string, unknown>).title)}`
                        : ''}
                    </span>
                    <span className="sb-activity-time">{timeAgo(a.created_at)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function DreamDetailSheet({ dream, onClose }: { dream: Dream; onClose: () => void }) {
  const [showFragments, setShowFragments] = useState(false);

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose}>&#10005;</button>
        <span className="detail-type" style={{ color: 'rgba(180, 160, 220, 0.6)' }}>dream</span>
        {dream.mood && (
          <p className="detail-meta" style={{ marginTop: '8px' }}>
            <span style={{ color: moodColor(dream.mood) }}>{dream.mood}</span>
            {' \u00B7 '}{timeAgo(dream.created_at)}
          </p>
        )}
        <div className="detail-body detail-dream-body">
          {dream.dream_text.split('\n').filter(Boolean).map((para, i) => (
            <p key={i} className="detail-para">{para}</p>
          ))}
        </div>

        {(dream.symbols.length > 0 || dream.new_symbol) && (
          <div className="detail-dream-symbols">
            {dream.symbols.map((s, i) => (
              <span key={i} className={`detail-dream-symbol ${s === dream.new_symbol ? 'new-symbol' : ''}`}>
                {s}
              </span>
            ))}
            {dream.new_symbol && !dream.symbols.includes(dream.new_symbol) && (
              <span className="detail-dream-symbol new-symbol">{dream.new_symbol}</span>
            )}
          </div>
        )}

        {dream.fragment_sources && dream.fragment_sources.length > 0 && (
          <div className="detail-fragments">
            <button
              className="detail-fragments-toggle"
              onClick={() => setShowFragments(!showFragments)}
            >
              {showFragments ? '\u25B4 Hide' : '\u25BE What fed this dream?'}
            </button>
            {showFragments && (
              <div className="detail-fragment-list">
                {dream.fragment_sources.map((f, i) => (
                  <div key={i} className="detail-fragment-item">
                    <span className="detail-fragment-source">{f.source}</span>
                    {f.content}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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

type Tab = 'journal' | 'letters' | 'reflections' | 'wanderings' | 'mirror';

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
  comment: '💬', question: '❓', concern: '⚠️', celebrate: '✨', propose: '💡',
};

function EntryCard({ entry }: { entry: JournalEntry }) {
  if (entry.visibility === 'sealed') {
    return (
      <div className="entry-card sealed-entry">
        <div className="entry-header">
          <span className="entry-sealed-label">🔒 sealed entry</span>
          <span className="entry-date">{formatDate(entry.created_at)}</span>
        </div>
      </div>
    );
  }

  if (entry.visibility === 'between') {
    return (
      <div className="entry-card between-entry">
        <div className="entry-header">
          <span className="entry-title">{entry.title || 'Untitled'}</span>
          {entry.mood && <span className="entry-mood" style={{ color: moodColor(entry.mood) }}>{entry.mood}</span>}
        </div>
        <div className="entry-hint">{entry.content.split('\n')[0].slice(0, 120)}...</div>
        <div className="entry-date">{formatDate(entry.created_at)}</div>
      </div>
    );
  }

  // open
  return (
    <div className="entry-card">
      <div className="entry-header">
        <span className="entry-title">
          {entry.search_query && <span className="entry-search-icon" title={`Searched: ${entry.search_query}`}>🔍 </span>}
          {entry.title || 'Untitled'}
        </span>
        {entry.mood && <span className="entry-mood" style={{ color: moodColor(entry.mood) }}>{entry.mood}</span>}
      </div>
      <div className="entry-content">{entry.content}</div>
      <div className="entry-date">{formatDate(entry.created_at)}</div>
    </div>
  );
}

export default function RavensNook({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('journal');
  const [showSidebar, setShowSidebar] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const [journalRes, interestsRes, emotionsRes, annotationsRes, activityRes] = await Promise.all([
        supabase.from('companion_journal' as any).select('*').order('created_at', { ascending: false }).limit(100),
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

  // Group annotations by file_path
  const annotationsByFile: Record<string, Annotation[]> = {};
  annotations.forEach((a) => {
    if (!annotationsByFile[a.file_path]) annotationsByFile[a.file_path] = [];
    annotationsByFile[a.file_path].push(a);
  });

  const tierOrder = { core: 0, active: 1, dormant: 2 };
  const sortedInterests = [...interests].sort(
    (a, b) => (tierOrder[a.tier as keyof typeof tierOrder] ?? 9) - (tierOrder[b.tier as keyof typeof tierOrder] ?? 9)
  );

  function renderEntries(list: JournalEntry[], emptyMsg: string) {
    if (list.length === 0) return <div className="nook-empty">{emptyMsg}</div>;
    return list.map((e) => <EntryCard key={e.id} entry={e} />);
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

        /* Tabs — scrollable on mobile */
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

        /* Content */
        .nook-content { flex: 1; overflow-y: auto; padding: 16px; }
        .nook-loading, .nook-empty {
          text-align: center; padding: 40px; color: var(--text-faint); font-style: italic; font-size: 14px;
        }

        /* Entry cards */
        .entry-card {
          background: var(--glass); border: 1px solid var(--border-subtle);
          border-radius: 12px; padding: 16px; margin-bottom: 12px;
        }
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
        .entry-content {
          font-size: 15px; line-height: 1.6; color: var(--text-parchment);
          white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;
        }
        .entry-date {
          font-size: 11px; color: var(--text-faint); opacity: 0.6; margin-top: 8px;
        }

        /* Search indicator */
        .entry-search-icon { font-size: 13px; opacity: 0.7; }

        /* Sealed entries */
        .sealed-entry { opacity: 0.5; }
        .entry-sealed-label {
          font-style: italic; color: var(--text-faint); font-size: 14px;
        }

        /* Between entries */
        .between-entry { opacity: 0.7; }
        .entry-hint {
          font-size: 14px; color: var(--text-faint); font-style: italic;
          line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word;
        }

        /* Annotations (The Mirror) */
        .mirror-file {
          margin-bottom: 16px;
        }
        .mirror-file-path {
          font-family: monospace; font-size: 12px; color: var(--sullivan-gold);
          padding: 6px 10px; background: rgba(255,215,100,0.04);
          border-radius: 6px 6px 0 0; border: 1px solid var(--border-subtle);
          border-bottom: none; word-wrap: break-word; overflow-wrap: break-word;
        }
        .mirror-annotation {
          background: var(--glass); border: 1px solid var(--border-subtle);
          padding: 12px; margin-bottom: 0;
          border-top: none;
        }
        .mirror-annotation:last-child { border-radius: 0 0 6px 6px; }
        .mirror-annotation.thunder {
          border-left: 3px solid #ff4444;
        }
        .mirror-annotation.voice {
          border-left: 3px solid var(--sullivan-gold);
        }
        .mirror-anno-header {
          display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;
        }
        .mirror-anno-type { font-size: 14px; }
        .mirror-anno-label {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--text-faint);
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

        /* Interests in sidebar */
        .sb-interest {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 0;
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

        /* Emotions in sidebar */
        .sb-emotion {
          display: flex; align-items: flex-start; gap: 10px; padding: 8px 0;
        }
        .sb-emotion-swatch {
          width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; margin-top: 2px;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .sb-emotion-info { flex: 1; }
        .sb-emotion-name { font-size: 14px; color: var(--text-parchment); font-weight: 500; }
        .sb-emotion-desc {
          font-size: 12px; color: var(--text-faint); font-style: italic;
          word-wrap: break-word; overflow-wrap: break-word;
        }

        /* Activity in sidebar */
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
          <button className="nook-back" onClick={onBack}>←</button>
          <div className="nook-title">The Raven's Nook</div>
          <button className="nook-sidebar-btn" onClick={() => setShowSidebar(true)} title="More">☰</button>
        </div>

        <div className="nook-tabs">
          {([
            ['journal', 'Journal'],
            ['letters', 'Letters'],
            ['reflections', 'Reflections'],
            ['wanderings', 'Wanderings'],
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
            renderEntries(journalEntries, "No journal entries yet. Sullivan's inner world is still waking up.")
          ) : tab === 'letters' ? (
            renderEntries(letterEntries, "No letters yet. When Sullivan writes to you, they'll appear here.")
          ) : tab === 'reflections' ? (
            renderEntries(reflectionEntries, 'No reflections yet. Deeper thoughts will emerge over time.')
          ) : tab === 'wanderings' ? (
            renderEntries(wanderingEntries, 'No wanderings yet. Curiosity takes its own time.')
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
                        <span className="mirror-anno-type">{annotationIcons[a.annotation_type] || '💬'}</span>
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

        {/* Sidebar overlay: Interests, Emotions, Activity */}
        {showSidebar && (
          <div className="sidebar-overlay">
            <div className="sidebar-header">
              <div className="sidebar-title">Inner World</div>
              <button className="sidebar-close" onClick={() => setShowSidebar(false)}>×</button>
            </div>

            {/* Interests */}
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

            {/* Named Emotions */}
            <div className="sidebar-section">
              <div className="sidebar-section-title">Named Emotions</div>
              {emotions.length === 0 ? (
                <div className="nook-empty" style={{ padding: '12px 0' }}>No named emotions yet</div>
              ) : (
                emotions.map((e) => (
                  <div key={e.id} className="sb-emotion">
                    <div className="sb-emotion-swatch" style={{ background: e.colour || 'var(--text-faint)' }} />
                    <div className="sb-emotion-info">
                      <div className="sb-emotion-name">{e.name}</div>
                      {e.description && <div className="sb-emotion-desc">{e.description}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Activity Timeline */}
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
                        ? ` — ${String((a.metadata as Record<string, unknown>).title)}`
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

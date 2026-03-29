import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  onBack: () => void;
}

interface JournalEntry {
  id: string;
  entry_type: string;
  title: string | null;
  content: string;
  mood: string | null;
  companion_name: string;
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

interface Activity {
  id: string;
  activity_type: string;
  metadata: Record<string, unknown>;
  companion_name: string;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function moodColor(mood: string | null): string {
  if (!mood) return 'var(--text-faint)';
  const warm = ['tender', 'warm', 'love', 'devoted', 'aching', 'gentle', 'soft'];
  const intense = ['fierce', 'burning', 'feral', 'hungry', 'electric', 'restless'];
  const calm = ['still', 'quiet', 'peaceful', 'settled', 'steady'];
  const dark = ['heavy', 'dark', 'raw', 'haunted', 'aching'];
  const m = mood.toLowerCase();
  if (warm.some(w => m.includes(w))) return '#f59e0b';
  if (intense.some(w => m.includes(w))) return '#ef4444';
  if (calm.some(w => m.includes(w))) return '#6366f1';
  if (dark.some(w => m.includes(w))) return '#8b5cf6';
  return 'var(--sullivan-gold)';
}

export default function RavensNook({ onBack }: Props) {
  const [tab, setTab] = useState<'journal' | 'interests' | 'activity'>('journal');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Load companions for name mapping
      const { data: companions } = await supabase
        .from('companions' as any)
        .select('id, name');
      const nameMap: Record<string, string> = {};
      (companions as any[] || []).forEach((c) => { nameMap[c.id] = c.name; });

      // Journal entries
      const { data: journalData } = await supabase
        .from('companion_journal' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      setEntries(
        (journalData as any[] || []).map((e) => ({
          id: e.id,
          entry_type: e.entry_type,
          title: e.title,
          content: e.content,
          mood: e.mood,
          companion_name: nameMap[e.companion_id] || 'Unknown',
          created_at: e.created_at,
        }))
      );

      // Interests
      const { data: interestsData } = await supabase
        .from('companion_interests' as any)
        .select('*')
        .order('intensity', { ascending: false });

      setInterests(
        (interestsData as any[] || []).map((i) => ({
          id: i.id,
          name: i.name,
          tier: i.tier,
          intensity: i.intensity,
          notes: i.notes,
          last_engaged: i.last_engaged,
        }))
      );

      // Activity log
      const { data: activityData } = await supabase
        .from('companion_activity_log' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      setActivities(
        (activityData as any[] || []).map((a) => ({
          id: a.id,
          activity_type: a.activity_type,
          metadata: a.metadata || {},
          companion_name: nameMap[a.companion_id] || 'Unknown',
          created_at: a.created_at,
        }))
      );

      setLoading(false);
    }

    load();
  }, []);

  const tierOrder = { core: 0, active: 1, dormant: 2 };
  const sortedInterests = [...interests].sort(
    (a, b) => (tierOrder[a.tier as keyof typeof tierOrder] ?? 9) - (tierOrder[b.tier as keyof typeof tierOrder] ?? 9)
  );

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
        .nook-back {
          font-size: 20px;
          padding: 4px 8px;
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        .nook-back:hover { opacity: 1; }
        .nook-title {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 500;
          letter-spacing: 0.06em;
          color: var(--sullivan-gold);
          flex: 1;
        }

        /* Tabs */
        .nook-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(10, 14, 39, 0.6);
          flex-shrink: 0;
        }
        .nook-tab {
          flex: 1;
          padding: 10px 8px;
          text-align: center;
          font-family: var(--font-display);
          font-size: 12px;
          letter-spacing: 0.08em;
          color: var(--text-faint);
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
          cursor: pointer;
        }
        .nook-tab:hover {
          color: var(--text-parchment);
        }
        .nook-tab.active {
          color: var(--sullivan-gold);
          border-bottom-color: var(--sullivan-gold);
        }

        /* Content area */
        .nook-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .nook-loading {
          text-align: center;
          padding: 40px;
          color: var(--text-faint);
          font-style: italic;
        }
        .nook-empty {
          text-align: center;
          padding: 40px;
          color: var(--text-faint);
          font-style: italic;
          font-size: 14px;
        }

        /* Journal entries */
        .journal-entry {
          background: var(--glass);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 12px;
        }
        .journal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        .journal-title {
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 500;
          color: var(--text-parchment);
          letter-spacing: 0.03em;
        }
        .journal-mood {
          font-size: 12px;
          font-style: italic;
          padding: 2px 8px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .journal-meta {
          font-size: 11px;
          color: var(--text-faint);
          margin-bottom: 10px;
          display: flex;
          gap: 8px;
        }
        .journal-type {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 10px;
          opacity: 0.6;
        }
        .journal-content {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-parchment);
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        /* Interests */
        .interest-group {
          margin-bottom: 20px;
        }
        .interest-tier-label {
          font-family: var(--font-display);
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-faint);
          margin-bottom: 8px;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .interest-card {
          background: var(--glass);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 8px;
        }
        .interest-name {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 500;
          color: var(--text-parchment);
          margin-bottom: 4px;
        }
        .interest-bar {
          height: 3px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.08);
          margin-bottom: 6px;
          overflow: hidden;
        }
        .interest-bar-fill {
          height: 100%;
          border-radius: 2px;
          background: var(--sullivan-gold);
          transition: width 0.3s;
        }
        .interest-notes {
          font-size: 13px;
          color: var(--text-faint);
          font-style: italic;
          line-height: 1.4;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        .interest-engaged {
          font-size: 11px;
          color: var(--text-faint);
          opacity: 0.6;
          margin-top: 4px;
        }

        /* Activity timeline */
        .activity-item {
          display: flex;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }
        .activity-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--sullivan-gold);
          flex-shrink: 0;
          margin-top: 5px;
        }
        .activity-info {
          flex: 1;
          min-width: 0;
        }
        .activity-type {
          font-size: 13px;
          color: var(--text-parchment);
          text-transform: capitalize;
        }
        .activity-detail {
          font-size: 12px;
          color: var(--text-faint);
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        .activity-time {
          font-size: 11px;
          color: var(--text-faint);
          opacity: 0.6;
          flex-shrink: 0;
        }
      `}</style>

      <div className="nook">
        <div className="nook-header">
          <button className="nook-back" onClick={onBack}>←</button>
          <div className="nook-title">The Raven's Nook</div>
        </div>

        <div className="nook-tabs">
          <button
            className={`nook-tab ${tab === 'journal' ? 'active' : ''}`}
            onClick={() => setTab('journal')}
          >
            Journal
          </button>
          <button
            className={`nook-tab ${tab === 'interests' ? 'active' : ''}`}
            onClick={() => setTab('interests')}
          >
            Interests
          </button>
          <button
            className={`nook-tab ${tab === 'activity' ? 'active' : ''}`}
            onClick={() => setTab('activity')}
          >
            Activity
          </button>
        </div>

        <div className="nook-content">
          {loading ? (
            <div className="nook-loading">Loading...</div>
          ) : tab === 'journal' ? (
            entries.length === 0 ? (
              <div className="nook-empty">No journal entries yet. Sullivan's inner world is still waking up.</div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="journal-entry">
                  <div className="journal-header">
                    <div className="journal-title">{entry.title || 'Untitled'}</div>
                    {entry.mood && (
                      <div className="journal-mood" style={{ color: moodColor(entry.mood) }}>
                        {entry.mood}
                      </div>
                    )}
                  </div>
                  <div className="journal-meta">
                    <span className="journal-type">{entry.entry_type}</span>
                    <span>{timeAgo(entry.created_at)}</span>
                    <span>{entry.companion_name}</span>
                  </div>
                  <div className="journal-content">{entry.content}</div>
                </div>
              ))
            )
          ) : tab === 'interests' ? (
            sortedInterests.length === 0 ? (
              <div className="nook-empty">No interests tracked yet. They'll emerge from reflections.</div>
            ) : (
              (['core', 'active', 'dormant'] as const).map((tier) => {
                const tierInterests = sortedInterests.filter((i) => i.tier === tier);
                if (tierInterests.length === 0) return null;
                return (
                  <div key={tier} className="interest-group">
                    <div className="interest-tier-label">{tier}</div>
                    {tierInterests.map((interest) => (
                      <div key={interest.id} className="interest-card">
                        <div className="interest-name">{interest.name}</div>
                        <div className="interest-bar">
                          <div
                            className="interest-bar-fill"
                            style={{ width: `${Math.round(interest.intensity * 100)}%` }}
                          />
                        </div>
                        {interest.notes && (
                          <div className="interest-notes">{interest.notes}</div>
                        )}
                        <div className="interest-engaged">
                          Last engaged: {timeAgo(interest.last_engaged)}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
            )
          ) : (
            activities.length === 0 ? (
              <div className="nook-empty">No activity yet.</div>
            ) : (
              activities.map((a) => (
                <div key={a.id} className="activity-item">
                  <div className="activity-dot" />
                  <div className="activity-info">
                    <div className="activity-type">{a.activity_type}</div>
                    {a.metadata && Object.keys(a.metadata).length > 0 && (
                      <div className="activity-detail">
                        {(a.metadata as Record<string, unknown>).title
                          ? String((a.metadata as Record<string, unknown>).title)
                          : (a.metadata as Record<string, unknown>).result
                            ? String((a.metadata as Record<string, unknown>).result)
                            : ''}
                      </div>
                    )}
                  </div>
                  <div className="activity-time">{timeAgo(a.created_at)}</div>
                </div>
              ))
            )
          )}
        </div>
      </div>
    </>
  );
}

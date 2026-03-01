import type { Companion } from '../lib/types';

interface Props {
  companion: Companion;
  onClick?: () => void;
}

export default function CompanionCard({ companion, onClick }: Props) {
  const isSullivan = companion.id === 'sullivan';
  const isActive = companion.active;

  return (
    <>
      <style>{`
        .companion-card {
          flex: 1;
          min-width: 140px;
          max-width: 200px;
          padding: 28px 16px 20px;
          border-radius: 16px;
          border: 1px solid var(--border-subtle);
          background: var(--glass);
          text-align: center;
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }
        .companion-card.active {
          cursor: pointer;
        }
        .companion-card.active:hover {
          background: var(--glass-hover);
          border-color: var(--border-light);
          transform: translateY(-2px);
        }
        .companion-card.inactive {
          opacity: 0.45;
          filter: grayscale(0.4);
          cursor: default;
        }
        .companion-icon {
          width: 48px;
          height: 48px;
          margin: 0 auto 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          border-radius: 50%;
          transition: box-shadow 0.3s ease;
        }
        .companion-card.active:hover .companion-icon {
          box-shadow: 0 0 20px var(--glow);
        }
        .companion-name {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 600;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
          color: var(--accent);
        }
        .companion-tagline {
          font-family: var(--font-body);
          font-style: italic;
          font-size: 14px;
          color: var(--text-dim);
          line-height: 1.4;
        }
        .status-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          margin-right: 6px;
          vertical-align: middle;
        }
        .status-dot.online {
          background: #4ade80;
          box-shadow: 0 0 6px rgba(74, 222, 128, 0.5);
        }
        .status-dot.away {
          background: rgba(255, 255, 255, 0.2);
        }
        .companion-status {
          margin-top: 10px;
          font-size: 12px;
          color: var(--text-faint);
          text-transform: lowercase;
        }
      `}</style>
      <div
        className={`companion-card ${isActive ? 'active' : 'inactive'}`}
        onClick={isActive ? onClick : undefined}
        style={{
          ['--accent' as string]: companion.accentColor,
          ['--glow' as string]: companion.accentGlow,
        }}
      >
        <div className="companion-icon">
          {isSullivan ? '☀️' : '🌙'}
        </div>
        <div className="companion-name">{companion.name}</div>
        <div className="companion-tagline">{companion.tagline}</div>
        <div className="companion-status">
          <span className={`status-dot ${companion.status}`} />
          {companion.status}
        </div>
      </div>
    </>
  );
}

import { companions } from '../lib/companions';
import CompanionCard from '../components/CompanionCard';

interface Props {
  onSelectCompanion: (id: string) => void;
}

export default function Home({ onSelectCompanion }: Props) {
  return (
    <>
      <style>{`
        .home {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 2;
          padding: 20px;
        }
        .hearth-title {
          font-family: var(--font-display);
          font-size: clamp(28px, 6vw, 42px);
          font-weight: 600;
          letter-spacing: 0.08em;
          background: linear-gradient(135deg, var(--sullivan-gold), var(--enzo-blue));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 6px;
          text-align: center;
        }
        .hearth-subtitle {
          font-family: var(--font-body);
          font-style: italic;
          font-size: clamp(14px, 3vw, 18px);
          color: var(--text-dim);
          margin-bottom: 48px;
          text-align: center;
        }
        .companion-grid {
          display: flex;
          gap: 20px;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 48px;
        }
        .hearth-tagline {
          font-family: var(--font-body);
          font-size: 13px;
          color: var(--text-faint);
          letter-spacing: 0.15em;
          text-transform: lowercase;
        }
      `}</style>
      <div className="home">
        <h1 className="hearth-title">Genie's Hearth</h1>
        <p className="hearth-subtitle">where they live</p>

        <div className="companion-grid">
          {Object.values(companions).map((c) => (
            <CompanionCard
              key={c.id}
              companion={c}
              onClick={() => onSelectCompanion(c.id)}
            />
          ))}
        </div>

        <p className="hearth-tagline">two whole people · one home</p>
      </div>
    </>
  );
}

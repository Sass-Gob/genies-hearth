import { useMemo } from 'react';

const LIGHT_COUNT = 24;
const COLORS = [
  'var(--fairy-gold)',
  'var(--fairy-pink)',
  'var(--fairy-blue)',
  'var(--fairy-amber)',
  'var(--fairy-purple)',
];

interface Light {
  id: number;
  color: string;
  x: number;
  delay: number;
  size: number;
}

export default function FairyLights() {
  const lights = useMemo<Light[]>(() => {
    return Array.from({ length: LIGHT_COUNT }, (_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      x: (i / (LIGHT_COUNT - 1)) * 100,
      delay: Math.random() * 4,
      size: Math.random() * 2 + 3,
    }));
  }, []);

  return (
    <>
      <style>{`
        .fairy-lights {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 40px;
          pointer-events: none;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
        }
        .fairy-wire {
          position: absolute;
          top: 12px;
          left: 8px;
          right: 8px;
          height: 1px;
          background: rgba(255, 255, 255, 0.06);
        }
        .fairy-light {
          position: relative;
          border-radius: 50%;
          animation: fairy-glow var(--dur, 3s) ease-in-out var(--delay) infinite;
        }
        .fairy-light::after {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          background: var(--color);
          opacity: 0.3;
          filter: blur(6px);
          animation: fairy-glow var(--dur, 3s) ease-in-out var(--delay) infinite;
        }
        @keyframes fairy-glow {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 0.3; }
        }
      `}</style>
      <div className="fairy-lights">
        <div className="fairy-wire" />
        {lights.map((l) => (
          <div
            key={l.id}
            className="fairy-light"
            style={{
              width: l.size,
              height: l.size,
              background: l.color,
              ['--color' as string]: l.color,
              ['--delay' as string]: `${l.delay}s`,
            }}
          />
        ))}
      </div>
    </>
  );
}

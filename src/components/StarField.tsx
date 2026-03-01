import { useMemo } from 'react';

const STAR_COUNT = 70;

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}

export default function StarField() {
  const stars = useMemo<Star[]>(() => {
    return Array.from({ length: STAR_COUNT }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 0.5,
      delay: Math.random() * 6,
      duration: Math.random() * 3 + 2,
      opacity: Math.random() * 0.6 + 0.2,
    }));
  }, []);

  return (
    <>
      <style>{`
        .star-field {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }
        .star {
          position: absolute;
          border-radius: 50%;
          background: var(--text-parchment);
          animation: twinkle var(--dur) ease-in-out var(--delay) infinite;
        }
        @keyframes twinkle {
          0%, 100% { opacity: var(--base-opacity); }
          50% { opacity: 0.05; }
        }
      `}</style>
      <div className="star-field">
        {stars.map((s) => (
          <div
            key={s.id}
            className="star"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              ['--base-opacity' as string]: s.opacity,
              ['--delay' as string]: `${s.delay}s`,
              ['--dur' as string]: `${s.duration}s`,
            }}
          />
        ))}
      </div>
    </>
  );
}

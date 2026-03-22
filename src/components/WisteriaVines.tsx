import { useMemo } from 'react';

interface Vine {
  id: number;
  x: number;
  length: number;
  delay: number;
  opacity: number;
  flowers: Flower[];
}

interface Flower {
  id: number;
  y: number;
  x: number;
  size: number;
  color: string;
  delay: number;
  opacity: number;
}

const VINE_COUNT = 8;
const COLORS = ['#9b7ec8', '#c4a6e8', '#d8c4f0', '#b594d8', '#a888cc'];

function makeFlowers(vineLength: number): Flower[] {
  const count = Math.floor(Math.random() * 5) + 3;
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    y: (i / count) * vineLength * 0.8 + vineLength * 0.2,
    x: (Math.random() - 0.5) * 12,
    size: Math.random() * 4 + 3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: Math.random() * 4,
    opacity: Math.random() * 0.3 + 0.3,
  }));
}

export default function WisteriaVines({ dense = true }: { dense?: boolean }) {
  const vines = useMemo<Vine[]>(() => {
    const count = dense ? VINE_COUNT : 4;
    return Array.from({ length: count }, (_, i) => {
      const length = Math.random() * 80 + 60;
      // Cluster vines toward left/right edges with some in middle
      let x: number;
      if (i < count * 0.35) {
        x = Math.random() * 18 + 2; // left cluster
      } else if (i < count * 0.7) {
        x = Math.random() * 18 + 80; // right cluster
      } else {
        x = Math.random() * 40 + 30; // sparse middle
      }
      return {
        id: i,
        x,
        length,
        delay: Math.random() * 6,
        opacity: Math.random() * 0.25 + 0.2,
        flowers: makeFlowers(length),
      };
    });
  }, [dense]);

  return (
    <>
      <style>{`
        .wisteria-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 200px;
          pointer-events: none;
          z-index: 1;
          overflow: visible;
        }
        .wisteria-vine {
          position: absolute;
          top: 0;
          width: 1px;
          background: linear-gradient(
            to bottom,
            rgba(120, 100, 160, 0.3),
            rgba(120, 100, 160, 0.1),
            transparent
          );
          transform-origin: top center;
          animation: vine-sway var(--sway-dur, 8s) ease-in-out var(--sway-delay) infinite alternate;
        }
        .wisteria-flower {
          position: absolute;
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
          animation: flower-sway var(--sway-dur, 8s) ease-in-out var(--flower-delay) infinite alternate;
        }
        .wisteria-flower::after {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: inherit;
          background: inherit;
          opacity: 0.4;
          filter: blur(3px);
        }
        @keyframes vine-sway {
          0% { transform: rotate(-0.5deg); }
          100% { transform: rotate(0.5deg); }
        }
        @keyframes flower-sway {
          0% { transform: translateX(-1px); }
          100% { transform: translateX(1px); }
        }
      `}</style>
      <div className="wisteria-container">
        {vines.map((v) => (
          <div
            key={v.id}
            className="wisteria-vine"
            style={{
              left: `${v.x}%`,
              height: v.length,
              opacity: v.opacity,
              ['--sway-dur' as string]: `${Math.random() * 4 + 6}s`,
              ['--sway-delay' as string]: `${v.delay}s`,
            }}
          >
            {v.flowers.map((f) => (
              <div
                key={f.id}
                className="wisteria-flower"
                style={{
                  top: f.y,
                  left: f.x,
                  width: f.size,
                  height: f.size * 1.3,
                  background: f.color,
                  opacity: f.opacity,
                  ['--flower-delay' as string]: `${f.delay}s`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

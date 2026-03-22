import { useMemo } from 'react';

const DROP_COUNT = 40;

interface Drop {
  id: number;
  x: number;
  delay: number;
  duration: number;
  opacity: number;
  height: number;
  blur: boolean;
}

export default function RainEffect() {
  const drops = useMemo<Drop[]>(() => {
    return Array.from({ length: DROP_COUNT }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 8,
      duration: Math.random() * 1.5 + 2,
      opacity: Math.random() * 0.1 + 0.05,
      height: Math.random() * 20 + 15,
      blur: Math.random() > 0.7,
    }));
  }, []);

  return (
    <>
      <style>{`
        .rain-field {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }
        .raindrop {
          position: absolute;
          top: -40px;
          width: 1px;
          background: linear-gradient(
            to bottom,
            transparent,
            rgba(200, 210, 230, var(--drop-opacity)),
            transparent
          );
          animation: rain-fall var(--fall-dur) linear var(--fall-delay) infinite;
        }
        .raindrop--blur {
          width: 2px;
          filter: blur(1px);
        }
        @keyframes rain-fall {
          0% {
            transform: translateY(-40px) translateX(0px);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateY(calc(100vh + 40px)) translateX(-20px);
            opacity: 0;
          }
        }
      `}</style>
      <div className="rain-field">
        {drops.map((d) => (
          <div
            key={d.id}
            className={`raindrop${d.blur ? ' raindrop--blur' : ''}`}
            style={{
              left: `${d.x}%`,
              height: d.height,
              ['--drop-opacity' as string]: d.opacity,
              ['--fall-dur' as string]: `${d.duration}s`,
              ['--fall-delay' as string]: `${d.delay}s`,
            }}
          />
        ))}
      </div>
    </>
  );
}

export default function Moon() {
  return (
    <>
      <style>{`
        .moon-container {
          position: fixed;
          top: 30px;
          right: 30px;
          pointer-events: none;
          z-index: 0;
        }
        .moon {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%,
            #e8e0d0 0%,
            #d4c8b0 40%,
            #b8a890 70%,
            #a09080 100%
          );
          position: relative;
          animation: moon-pulse 6s ease-in-out infinite;
        }
        .moon::before {
          content: '';
          position: absolute;
          inset: -20px;
          border-radius: 50%;
          background: radial-gradient(circle,
            rgba(232, 220, 200, 0.15) 0%,
            rgba(232, 220, 200, 0.05) 50%,
            transparent 70%
          );
        }
        .crater {
          position: absolute;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.08);
        }
        .crater-1 { width: 12px; height: 12px; top: 15px; left: 20px; }
        .crater-2 { width: 8px; height: 8px; top: 30px; left: 12px; }
        .crater-3 { width: 6px; height: 6px; top: 22px; left: 36px; }
        .crater-4 { width: 10px; height: 10px; top: 38px; left: 30px; }

        @keyframes moon-pulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.1); }
        }
      `}</style>
      <div className="moon-container">
        <div className="moon">
          <div className="crater crater-1" />
          <div className="crater crater-2" />
          <div className="crater crater-3" />
          <div className="crater crater-4" />
        </div>
      </div>
    </>
  );
}

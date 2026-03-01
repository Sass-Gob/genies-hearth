export default function NebulaBg() {
  return (
    <>
      <style>{`
        .nebula-bg {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          background:
            radial-gradient(ellipse 600px 400px at 20% 80%, rgba(100, 60, 180, 0.08), transparent),
            radial-gradient(ellipse 500px 300px at 80% 20%, rgba(60, 80, 180, 0.06), transparent),
            radial-gradient(ellipse 800px 600px at 50% 50%, rgba(17, 22, 64, 0.5), transparent),
            linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-mid) 50%, var(--bg-deep) 100%);
        }
      `}</style>
      <div className="nebula-bg" />
    </>
  );
}

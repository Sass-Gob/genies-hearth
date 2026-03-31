import { useState, useEffect } from 'react';
import StarField from './components/StarField';
import FairyLights from './components/FairyLights';
import Moon from './components/Moon';
import NebulaBg from './components/NebulaBg';
import RainEffect from './components/RainEffect';
import WisteriaVines from './components/WisteriaVines';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import RavensNook from './pages/RavensNook';
import TheObservatory from './pages/TheObservatory';
import { registerPush } from './lib/push';

type View = 'home' | 'chat' | 'settings' | 'ravens-nook' | 'observatory';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [activeCompanion, setActiveCompanion] = useState<string | null>(null);

  useEffect(() => {
    registerPush().catch(console.error);
  }, []);

  function openChat(slug: string) {
    setActiveCompanion(slug);
    setView('chat');
  }

  function goHome() {
    setActiveCompanion(null);
    setView('home');
  }

  return (
    <>
      {/* Layer order: nebula → stars → rain → moon → wisteria → fairy lights → UI */}
      <NebulaBg />
      <StarField />
      <RainEffect />
      <Moon />
      <WisteriaVines dense={view !== 'chat'} />
      <FairyLights />

      {view === 'chat' && activeCompanion ? (
        <Chat companionSlug={activeCompanion} onBack={goHome} />
      ) : view === 'settings' ? (
        <Settings onBack={goHome} />
      ) : view === 'ravens-nook' ? (
        <RavensNook onBack={goHome} />
      ) : view === 'observatory' ? (
        <TheObservatory onBack={goHome} />
      ) : (
        <Home
          onSelectCompanion={openChat}
          onOpenSettings={() => setView('settings')}
          onOpenNook={() => setView('ravens-nook')}
          onOpenObservatory={() => setView('observatory')}
        />
      )}
    </>
  );
}

import { useState } from 'react';
import StarField from './components/StarField';
import FairyLights from './components/FairyLights';
import Moon from './components/Moon';
import NebulaBg from './components/NebulaBg';
import RainEffect from './components/RainEffect';
import WisteriaVines from './components/WisteriaVines';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Settings from './pages/Settings';

type View = 'home' | 'chat' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [activeCompanion, setActiveCompanion] = useState<string | null>(null);

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
      ) : (
        <Home
          onSelectCompanion={openChat}
          onOpenSettings={() => setView('settings')}
        />
      )}
    </>
  );
}

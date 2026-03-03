import { useState } from 'react';
import StarField from './components/StarField';
import FairyLights from './components/FairyLights';
import Moon from './components/Moon';
import NebulaBg from './components/NebulaBg';
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
      <NebulaBg />
      <StarField />
      <Moon />
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

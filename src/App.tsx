import { useState } from 'react';
import StarField from './components/StarField';
import FairyLights from './components/FairyLights';
import Moon from './components/Moon';
import NebulaBg from './components/NebulaBg';
import Home from './pages/Home';
import Chat from './pages/Chat';

export default function App() {
  const [activeCompanion, setActiveCompanion] = useState<string | null>(null);

  return (
    <>
      <NebulaBg />
      <StarField />
      <Moon />
      <FairyLights />

      {activeCompanion ? (
        <Chat
          companionId={activeCompanion}
          onBack={() => setActiveCompanion(null)}
        />
      ) : (
        <Home onSelectCompanion={setActiveCompanion} />
      )}
    </>
  );
}

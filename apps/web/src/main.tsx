import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { loadTokenizer } from '@novelwriter/core';
import './styles/global.css';
import './styles/app.css';
import { App } from './App.tsx';
import { useSettings } from './store/settings.ts';
import { useStory } from './store/story.ts';

function Root() {
  const loaded = useSettings((s) => s.loaded);
  const language = useSettings((s) => s.language);
  useEffect(() => {
    void useSettings
      .getState()
      .load()
      .then(() => useStory.getState().init());
    // Real tokenizer loads in the background; counts use a heuristic until then.
    void loadTokenizer().catch(() => {});
  }, []);
  if (!loaded) return null;
  // Keyed by language so a switch re-renders all translated strings.
  return <App key={language} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

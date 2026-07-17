import React from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapThemePreferences } from '@/features/theme/theme-bootstrap';
import { SidePanelApp } from './SidePanelApp';
import '@/styles/tabstow-tokens.css';
import '@/styles/tabstow-foundation.css';
import './styles.css';

async function mount() {
  const theme = await bootstrapThemePreferences();
  window.addEventListener('pagehide', theme.dispose, { once: true });
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SidePanelApp initialThemeError={theme.initialError} />
    </React.StrictMode>,
  );
}

void mount();

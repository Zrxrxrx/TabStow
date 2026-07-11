import React from 'react';
import { createRoot } from 'react-dom/client';
import { HistoryApp } from './HistoryApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HistoryApp />
  </React.StrictMode>,
);

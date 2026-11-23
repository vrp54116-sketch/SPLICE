import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('SPLICE root element is missing');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void navigator.serviceWorker?.register('/sw.js').catch(() => { /* offline shell is optional */ });

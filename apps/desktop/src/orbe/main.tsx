import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/base.css';
import './orbe.css';
import { Orbe } from './Orbe.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Orbe />
  </StrictMode>,
);

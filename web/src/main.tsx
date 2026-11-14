import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Concept from './pages/Concept';
import Numbers from './pages/Numbers';
import './index.css';

// "/concept" and "/numbers" are pages of their own; every other address is a review
const path = location.pathname.replace(/\/+$/, '');
const Page = path === '/concept' ? Concept : path === '/numbers' ? Numbers : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);

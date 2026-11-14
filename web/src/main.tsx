import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Concept from './pages/Concept';
import Numbers from './pages/Numbers';
import SignIn from './pages/SignIn';
import './index.css';

// "/concept", "/numbers" and "/signin" are pages of their own; every other address is a review
const path = location.pathname.replace(/\/+$/, '');
const Page = path === '/concept' ? Concept : path === '/numbers' ? Numbers : path === '/signin' ? SignIn : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);

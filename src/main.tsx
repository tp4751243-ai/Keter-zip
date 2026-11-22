import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      {/* v0.8.1 — white-screen fix: top-level boundary. If anything above
          the workspace boundary throws (header, providers, the App shell
          itself), the user still gets a friendly fallback with Reload
          instead of a blank white window. */}
      <ErrorBoundary label="app">
        <App />
      </ErrorBoundary>
    </LanguageProvider>
  </StrictMode>,
);

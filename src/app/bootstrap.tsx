import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App';
import { ErrorBoundary } from '../components/ui';
import { TooltipProvider } from '../components/ui/TooltipProvider';
import { AppProvider } from '../context';
import type { AppData } from '../model';
import { PreferencesProvider, initializePreferences } from '../preferences/PreferencesProvider';
import '../styles.css';

export function mountApp(initialData?: () => AppData) {
  initializePreferences();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <PreferencesProvider>
          <AppProvider initialData={initialData}>
            <App />
            <TooltipProvider />
          </AppProvider>
        </PreferencesProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

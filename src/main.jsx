import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';
import { registerServiceWorker } from './sw-register';
import { installAuthFetch } from './utils/authClient';

// Register Service Worker for offline PWA shell
registerServiceWorker();

// Attach the login token to every API call app-wide (dashboards, modals,
// offline sync engine). Must run before App renders any data fetching.
installAuthFetch();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

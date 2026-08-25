import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import GraphPage from './components/GraphPage';
import { pollInterval } from './polling';
import 'reactflow/dist/style.css';
import './styles.css';

// Polling strategy and the reasoning behind the intervals live in polling.ts.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: pollInterval,
      refetchIntervalInBackground: false,
      staleTime: 2000,
    },
  },
});

// No router: one graph opened in its own tab (see InstanceDetail's "open in
// new tab") is the only other "page" this app has, so a URL param is enough.
const params = new URLSearchParams(window.location.search);
const instanceId = params.get('instance');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {instanceId ? (
        <GraphPage instanceId={instanceId} target={params.get('target')} />
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </React.StrictMode>
);

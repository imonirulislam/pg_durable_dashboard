import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

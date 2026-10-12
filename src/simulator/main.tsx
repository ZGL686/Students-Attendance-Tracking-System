import React from 'react';
import ReactDOM from 'react-dom/client';
import { PhoneSimulator } from './PhoneSimulator';
import './simulator.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PhoneSimulator />
  </React.StrictMode>,
);

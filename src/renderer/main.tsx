import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { OutputWindowView } from './components/OutputWindowView';
import './styles/index.css';

const role = new URLSearchParams(window.location.search).get('role');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {role === 'output' ? <OutputWindowView /> : <App />}
  </React.StrictMode>
);

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// MediaPipe's Emscripten WASM runtime writes informational TFLite logs to stderr (console.error).
// Route only the benign "INFO: Created TensorFlow Lite ..." notice to console.info.
const originalConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('INFO: Created TensorFlow Lite')) {
    console.info(...args);
    return;
  }
  originalConsoleError.apply(console, args);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

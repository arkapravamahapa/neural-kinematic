Stop-Process -Id 19140 -Force
node server.js


npx vite

## Local development on Windows

Start the backend in one terminal with `npm run dev`. The API listens on
`http://localhost:3000` and the movement WebSocket listens on
`ws://localhost:24678`.

To run the frontend separately, start `npx vite --host 127.0.0.1 --port 5173`
in a second terminal. The Vite config defaults to port 5173; port 3001 also
works with `npx vite --host 127.0.0.1 --port 3001`. The frontend detects the
backend URLs automatically.






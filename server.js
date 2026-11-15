import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI } from '@google/genai';
import { PatientSessionAnalyzer } from './server/kinematics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXERCISE_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'server', 'config', 'exercises.json'), 'utf-8')
);

// In-memory session storage (replaces external Supabase table)
const sessionsStore = [];
let nextSessionId = 1;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'Research Backend Active', engine: 'JS Signal Processing' });
});

app.get('/api/exercises', (_req, res) => {
  res.json(EXERCISE_CONFIG);
});

app.post('/api/save_session', (req, res) => {
  try {
    const {
      patient_id,
      exercise_id,
      leftMaxROM,
      rightMaxROM,
      symmetryScore,
      repCount,
    } = req.body || {};

    const record = {
      id: nextSessionId++,
      patient_id: String(patient_id || '11111111-1111-1111-1111-111111111111'),
      exercise_id: String(exercise_id || 'knee_flexion_001'),
      left_max_rom: Number(leftMaxROM || 0),
      right_max_rom: Number(rightMaxROM || 0),
      symmetry_score: Number(symmetryScore || 0),
      rep_count: Number(repCount || 0),
      created_at: new Date().toISOString(),
    };

    sessionsStore.unshift(record);
    res.json({ message: 'Session data secured', data: [record] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/history/:patient_id', (req, res) => {
  const { patient_id } = req.params;
  const history = sessionsStore
    .filter((s) => s.patient_id === patient_id)
    .slice(0, 10);
  res.json(history);
});

app.get('/api/population', (_req, res) => {
  res.json(sessionsStore);
});

app.post('/api/chat', async (req, res) => {
  try {
    const message = req.body?.message || '';
    if (!ai) {
      return res.json({
        reply:
          'GEMINI_API_KEY is not configured. Add GEMINI_API_KEY in Settings > Secrets to enable the Medical AI Assistant.',
      });
    }

    const prompt = `
You are the 'Neural-Kinematic AI Assistant', an expert biomechanical and physical therapy AI.
A doctor is asking you a question on their clinical dashboard.
Keep your answer professional, concise, and focused on joint health, kinematics, or physical rehabilitation.
Doctor's Query: ${message}
    `.trim();

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
    });

    res.json({ reply: response.text || 'No response generated.' });
  } catch (err) {
    res.json({
      reply: `AI Connection Error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws/movement' });

let activeExerciseKey = 'knee_flexion';
const analyzer = new PatientSessionAnalyzer(EXERCISE_CONFIG[activeExerciseKey]);
let lastTelemetryPayload = null;

function resolveExerciseKey(keyOrId) {
  if (!keyOrId) return activeExerciseKey;
  if (EXERCISE_CONFIG[keyOrId]) return keyOrId;
  const found = Object.keys(EXERCISE_CONFIG).find(
    (k) => EXERCISE_CONFIG[k].id === keyOrId
  );
  return found || activeExerciseKey;
}

wss.on('connection', (ws) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'exercise_changed',
        exercise_key: activeExerciseKey,
        config: EXERCISE_CONFIG[activeExerciseKey],
      })
    );
    if (lastTelemetryPayload) {
      ws.send(lastTelemetryPayload);
    }
  }

  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(raw.toString());

      if (payload?.type === 'select_exercise') {
        const nextKey = resolveExerciseKey(payload.exercise_key || payload.exercise_id);
        activeExerciseKey = nextKey;
        analyzer.setConfig(EXERCISE_CONFIG[activeExerciseKey]);
        lastTelemetryPayload = null;

        const switchedMsg = JSON.stringify({
          type: 'exercise_changed',
          exercise_key: activeExerciseKey,
          config: EXERCISE_CONFIG[activeExerciseKey],
        });
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(switchedMsg);
          }
        }
        return;
      }

      if (payload?.type === 'reset_session') {
        analyzer.reset();
        lastTelemetryPayload = null;
        return;
      }

      if (payload?.type === 'skeleton_telemetry') {
        const requestedKey = resolveExerciseKey(payload.exercise_key || payload.exercise_id);
        if (requestedKey !== activeExerciseKey) {
          activeExerciseKey = requestedKey;
          analyzer.setConfig(EXERCISE_CONFIG[activeExerciseKey]);
        }

        const landmarks = payload.landmarks || [];
        const minLandmarks = EXERCISE_CONFIG[activeExerciseKey].tracker === 'hands' ? 21 : 29;
        if (landmarks.length >= minLandmarks) {
          const timestamp = Date.now() / 1000;
          const clinicalMetrics = analyzer.processFrame(landmarks, timestamp);
          const out = JSON.stringify({
            type: 'clinical_telemetry',
            exercise_key: activeExerciseKey,
            tracker: EXERCISE_CONFIG[activeExerciseKey].tracker,
            raw_skeleton: landmarks,
            metrics: clinicalMetrics,
          });
          lastTelemetryPayload = out;
          for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(out);
            }
          }
        }
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.join(__dirname, 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Neural-Kinematic server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

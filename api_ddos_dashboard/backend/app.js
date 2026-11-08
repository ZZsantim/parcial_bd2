import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import consultaRoutes from './routes/consultaRoutes.js';
import informeRoutes from './routes/informeRoutes.js';
import { getDB } from './config/db.js';
import {
  getChangeStreamStatus,
  streamFlowEvents,
} from './services/changeStreamService.js';
import { getOllamaStatus } from './services/consultaService.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/events/flows', streamFlowEvents);

app.get('/api/health', async (_req, res) => {
  try {
    const database = getDB();
    const [, ollama] = await Promise.all([
      database.command({ ping: 1 }),
      getOllamaStatus(),
    ]);
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      realtime: getChangeStreamStatus(),
      ollama,
      service: 'api-ddos-dashboard',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[APP] Health check de MongoDB falló:', error.message);
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      service: 'api-ddos-dashboard',
    });
  }
});

app.use('/api/informes', informeRoutes);
app.use('/api/consultas', consultaRoutes);

app.use(express.static(path.resolve(__dirname, '../frontend')));

app.use((_req, res) => {
  res.status(404).json({ message: 'Ruta no encontrada.' });
});

app.use((err, _req, res, _next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500
    ? err.status
    : 500;
  console.error('[APP] Error no manejado:', err.message);
  res.status(status).json({
    message: status === 400 ? 'Solicitud JSON inválida.' : 'Error interno del servidor.',
  });
});

export default app;

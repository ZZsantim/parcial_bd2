import express from 'express';
import cors from 'cors';
import informeRoutes from './routes/informeRoutes.js';
import { getDB } from './config/db.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', async (_req, res) => {
  try {
    await getDB().command({ ping: 1 });
    res.status(200).json({
      status: 'ok',
      database: 'connected',
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

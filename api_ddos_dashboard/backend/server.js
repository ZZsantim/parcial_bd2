import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app.js';
import { closeDB, connectDB } from './config/db.js';
import { startChangeStream, stopChangeStream } from './services/changeStreamService.js';
import { calentarOllama } from './services/consultaService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const port = Number(process.env.PORT || 3000);

const startServer = async () => {
  await connectDB();
  await startChangeStream();

  const server = app.listen(port, () => {
    console.log(`[HTTP] Servidor escuchando en http://localhost:${port}`);
    calentarOllama();
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopChangeStream();
    server.close(async () => {
      try {
        await closeDB();
        process.exit(0);
      } catch (error) {
        console.error('[HTTP] Error cerrando MongoDB:', error);
        process.exit(1);
      }
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

startServer().catch((error) => {
  console.error('[HTTP] Error iniciando servidor:', error);
  process.exit(1);
});

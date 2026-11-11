import { getDB, getFlowsCollection } from '../config/db.js';
import {
  aplicarCambios,
  crearColaIncremental,
  eventosResumen,
  marcarDesactualizado,
  reducirFlujo,
} from './resumenService.js';

const subscribers = new Set();
let changeStream = null;
let retryTimer = null;
let retryAttempt = 0;
let stopping = false;
let status = 'starting';

const writeEvent = (response, event, data) => {
  if (!response.writableEnded) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
};

const broadcast = (event, data) => {
  for (const response of subscribers) {
    writeEvent(response, event, data);
  }
};

const marcarResumenesDesactualizados = (motivo) => {
  marcarDesactualizado(getDB(), motivo).catch((error) => {
    console.error('[Resúmenes] No se pudo marcar el estado como desactualizado:', error.message);
  });
};

// Cada cambio se aplica a los resúmenes por lotes, sin recorrer la colección: la inserción
// suma el documento; update/replace restan la pre-image y suman la post-image; delete resta
// la pre-image (flujos_limpia tiene changeStreamPreAndPostImages, ver createIndexes.js).
// Si falta alguna imagen (caducó o no estaba habilitado), se marca desactualizado.
let colaIncremental = null;
const crearCola = () => crearColaIncremental({
  aplicar: (cambios) => aplicarCambios(getDB(), cambios),
  alFallar: (error, lote) => {
    console.error(`[Resúmenes] No se pudieron aplicar ${lote.length} cambios:`, error.message);
    marcarResumenesDesactualizados(`Falló el incremento de ${lote.length} cambios: ${error.message}`);
  },
  alDesbordar: () => marcarResumenesDesactualizados('Demasiados cambios pendientes; se descartó la cola incremental.'),
});

eventosResumen.on('actualizados', (detalle) => {
  broadcast('resumenes-actualizados', { ...detalle, at: new Date().toISOString() });
});

const reportChange = (change) => {
  const documentId = change.documentKey?._id ?? null;
  const { operationType: operacion, fullDocument: despues, fullDocumentBeforeChange: antes } = change;
  const completo = operacion === 'insert' ? Boolean(despues)
    : operacion === 'delete' ? Boolean(antes)
      : Boolean(antes && despues);
  if (completo) {
    if (operacion !== 'insert') colaIncremental?.agregar({ signo: -1, doc: reducirFlujo(antes) });
    if (operacion !== 'delete') {
      colaIncremental?.agregar({ signo: 1, doc: reducirFlujo(despues), insercion: operacion === 'insert' });
    }
  } else {
    marcarResumenesDesactualizados(
      `Operación "${operacion}" sobre ${documentId ?? 'un documento'} sin pre/post-image; recalcula con POST /api/informes/resumenes/refrescar.`,
    );
  }
  broadcast('mongo-change', {
    operation: change.operationType,
    documentId: documentId?.toString() ?? null,
    at: new Date().toISOString(),
  });
};

const scheduleReconnect = () => {
  if (stopping || retryTimer) return;

  retryAttempt += 1;
  const delay = Math.min(1_000 * (2 ** (retryAttempt - 1)), 30_000);
  status = 'reconnecting';
  broadcast('stream-status', { status });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    openChangeStream().catch((error) => {
      console.error('[MongoDB] No se pudo reabrir el change stream:', error.message);
      scheduleReconnect();
    });
  }, delay);
};

const consumeChanges = async (stream) => {
  try {
    while (!stopping && changeStream === stream) {
      const change = await stream.tryNext();
      if (change) reportChange(change);
    }
  } catch (error) {
    if (stopping || changeStream !== stream) return;
    console.error('[MongoDB] Change stream interrumpido:', error.message);
    changeStream = null;
    try {
      await stream.close();
    } catch (closeError) {
      console.error('[MongoDB] Error cerrando change stream:', closeError.message);
    }
    scheduleReconnect();
  }
};

const openChangeStream = async () => {
  if (stopping) return;

  const stream = getFlowsCollection().watch(
    [{ $match: { operationType: { $in: ['insert', 'update', 'replace', 'delete'] } } }],
    { maxAwaitTimeMS: 1_000, fullDocument: 'whenAvailable', fullDocumentBeforeChange: 'whenAvailable' },
  );
  changeStream = stream;

  const initialChange = await stream.tryNext();
  if (initialChange) reportChange(initialChange);
  if (retryAttempt > 0) {
    marcarResumenesDesactualizados('El change stream se reconectó; pudieron perderse eventos mientras estuvo caído.');
  }
  retryAttempt = 0;
  status = 'connected';
  broadcast('stream-status', { status });
  consumeChanges(stream);
};

export const startChangeStream = async () => {
  stopping = false;
  colaIncremental = crearCola();
  await openChangeStream();
};

export const getChangeStreamStatus = () => status;

export const streamFlowEvents = (req, res) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  subscribers.add(res);
  writeEvent(res, 'stream-status', { status });
  writeEvent(res, 'connected', { at: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
  });
};

export const stopChangeStream = async () => {
  stopping = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  status = 'stopped';
  broadcast('stream-status', { status });
  for (const response of subscribers) response.end();
  subscribers.clear();
  if (changeStream) {
    const stream = changeStream;
    changeStream = null;
    await stream.close();
  }
  if (colaIncremental) {
    const cola = colaIncremental;
    colaIncremental = null;
    await cola.detener();
  }
};

export default {
  startChangeStream,
  getChangeStreamStatus,
  streamFlowEvents,
  stopChangeStream,
};

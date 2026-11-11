import { getDB, getFlowsCollection } from '../config/db.js';
import { serializeFlujo } from '../models/informe.js';
import {
  COLECCIONES,
  pipelineLecturaAnalitica,
  pipelineLecturaResumen,
  pipelineLecturaSeries,
  pipelineLecturaTopIps,
} from './resumenPipelines.js';

// Los informes 1 a 8 se calculan sobre el dataset completo: se leen de las colecciones
// resumen que genera `npm run db:resumenes` (agregaciones con $merge sobre flujos_limpia).
// Cada lectura es una sola agregación sobre resumen_general con $lookup a los demás resúmenes.

const LECTURA_MAX_TIME_MS = 5_000;

export class ResumenesNoDisponiblesError extends Error {
  constructor() {
    super('Las colecciones resumen no existen todavía. Ejecuta "npm run db:resumenes".');
    this.code = 'RESUMENES_NO_DISPONIBLES';
  }
}

const leerResumen = async (pipeline, db = getDB()) => {
  const [resultado] = await db
    .collection(COLECCIONES.general)
    .aggregate(pipeline, { maxTimeMS: LECTURA_MAX_TIME_MS })
    .toArray();
  if (!resultado) throw new ResumenesNoDisponiblesError();
  return resultado;
};

// Informe 1: indicadores generales.
export const getResumen = async (db) => leerResumen(pipelineLecturaResumen(), db);

// Informe 3: IPs de origen con más flujos de ataque.
export const getTopIps = async (limit = 5, db = undefined) => leerResumen(pipelineLecturaTopIps(limit), db);

// Informe 2: flujos y ataques por día.
export const getSeries = async (days = 7, db = undefined) => leerResumen(pipelineLecturaSeries(days), db);

// Informes 2 y 4 a 8: serie diaria, tipos de ataque, destinos, protocolos, puertos y horas.
export const getAnalitica = async (days = 7, limit = 8, db = undefined) => (
  leerResumen(pipelineLecturaAnalitica(days, limit), db)
);

export const getInformes = async (limit = 20) => {
  const collection = getFlowsCollection();
  const registros = await collection
    .find(
      {},
      {
        projection: {
          Timestamp: 1,
          'Source IP': 1,
          'Destination IP': 1,
          'Source Port': 1,
          'Destination Port': 1,
          Protocol: 1,
          Label: 1,
          'Flow Duration': 1,
          'Flow Bytes/s': 1,
          'Total Fwd Packets': 1,
          'Total Backward Packets': 1,
        },
      },
    )
    .sort({ Timestamp: -1 })
    .limit(limit)
    .toArray();

  return registros.map(serializeFlujo);
};

export default {
  getResumen,
  getTopIps,
  getSeries,
  getAnalitica,
  getInformes,
};

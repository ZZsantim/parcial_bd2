import { flowsCollectionName, getDB, getFlowsCollection } from '../config/db.js';
import { serializeFlujo } from '../models/informe.js';
import {
  COLECCIONES,
  pipelineComparacion,
  pipelineFiltrado,
  pipelineLecturaAnalitica,
  pipelineLecturaResumen,
  pipelineLecturaSeries,
  pipelineLecturaTopIps,
} from './resumenPipelines.js';

// Los informes 1 a 8 se calculan sobre el dataset completo: se leen de las colecciones
// resumen que genera `npm run db:resumenes` (agregaciones con $merge sobre flujos_limpia).
// Cada lectura es una sola agregación sobre resumen_general con $lookup a los demás resúmenes.

const LECTURA_MAX_TIME_MS = 5_000;
// Con filtros la lectura recorre flujos_limpia (con índices) en vez de los resúmenes.
const FILTRADA_MAX_TIME_MS = Number(process.env.CONSULTA_MAX_TIME_MS || 120_000);

export class ResumenesNoDisponiblesError extends Error {
  constructor() {
    super('Las colecciones resumen no existen todavía. Ejecuta "npm run db:resumenes".');
    this.code = 'RESUMENES_NO_DISPONIBLES';
  }
}

/**
 * Convierte los filtros ya validados en un $match sobre campos con índice; null si no hay.
 * desde/hasta llegan normalizados a "YYYY-MM-DD HH:MM:SS", igual que Timestamp.
 */
export const matchFiltros = ({ label, protocol, desde, hasta } = {}) => {
  const match = {};
  if (label !== undefined) match.Label = label;
  if (protocol !== undefined) match.Protocol = protocol;
  if (desde !== undefined || hasta !== undefined) {
    match.Timestamp = {
      ...(desde !== undefined ? { $gte: desde } : {}),
      ...(hasta !== undefined ? { $lte: hasta } : {}),
    };
  }
  return Object.keys(match).length ? match : null;
};

const leerResumen = async (pipeline, db = getDB(), filtros = {}) => {
  const match = matchFiltros(filtros);
  const [resultado] = match
    ? await db
      .collection(flowsCollectionName)
      .aggregate(pipelineFiltrado(match, pipeline), { maxTimeMS: FILTRADA_MAX_TIME_MS, allowDiskUse: true })
      .toArray()
    : await db
      .collection(COLECCIONES.general)
      .aggregate(pipeline, { maxTimeMS: LECTURA_MAX_TIME_MS })
      .toArray();
  if (!resultado) throw new ResumenesNoDisponiblesError();
  return resultado;
};

// Informe 1: indicadores generales.
export const getResumen = async (db = undefined, filtros = {}) => leerResumen(pipelineLecturaResumen(), db, filtros);

// Informe 3: IPs de origen con más flujos de ataque.
export const getTopIps = async (limit = 5, db = undefined, filtros = {}) => (
  leerResumen(pipelineLecturaTopIps(limit), db, filtros)
);

// Informe 2: flujos y ataques por día.
export const getSeries = async (days = 7, db = undefined, filtros = {}) => (
  leerResumen(pipelineLecturaSeries(days), db, filtros)
);

// Informes 2 y 4 a 8: serie diaria, tipos de ataque, destinos, protocolos, puertos y horas.
export const getAnalitica = async (days = 7, limit = 8, db = undefined, filtros = {}) => (
  leerResumen(pipelineLecturaAnalitica(days, limit), db, filtros)
);

// Informe de comparación: dos periodos {desde, hasta} en una agregación sobre resumen_base.
export const getComparacion = async (a, b, db = getDB()) => {
  const filas = await db
    .collection(COLECCIONES.base)
    .aggregate(pipelineComparacion(a, b), { maxTimeMS: LECTURA_MAX_TIME_MS })
    .toArray();
  const periodo = (id, rango) => ({
    ...rango,
    flujos: 0,
    ataques: 0,
    porcentajeAtaques: 0,
    topLabels: [],
    ...filas.find((fila) => fila.periodo === id),
    periodo: id,
  });
  return { periodoA: periodo('A', a), periodoB: periodo('B', b) };
};

export const getInformes = async (limit = 20, filtros = {}) => {
  const collection = getFlowsCollection();
  const registros = await collection
    .find(
      matchFiltros(filtros) ?? {},
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
    .maxTimeMS(FILTRADA_MAX_TIME_MS)
    .toArray();

  return registros.map(serializeFlujo);
};

export default {
  getResumen,
  getTopIps,
  getSeries,
  getAnalitica,
  getComparacion,
  getInformes,
};

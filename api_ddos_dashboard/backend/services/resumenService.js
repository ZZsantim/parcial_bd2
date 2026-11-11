import { EventEmitter } from 'node:events';
import { ObjectId } from 'mongodb';
import {
  CAMPOS_BASE,
  COLECCIONES,
  DERIVACIONES,
  ID_GENERAL,
  INDICES_RESUMEN,
  etapaMerge,
  pipelineBase,
  pipelineDerivacion,
} from '../repositories/resumenPipelines.js';

const ID_ESTADO = 'resumenes';
// Un recálculo que lleve más de esto se considera abandonado (proceso caído) y se puede retomar.
const BLOQUEO_MAX_MS = 3 * 60 * 60 * 1000;
const MAX_TIME_RECALCULO_MS = 2 * 60 * 60 * 1000;

// Avisa a quien escuche (p. ej. el SSE del dashboard) de que los resúmenes cambiaron.
export const eventosResumen = new EventEmitter();

export class RecalculoEnCursoError extends Error {
  constructor() {
    super('Ya hay un recálculo de resúmenes en curso.');
    this.code = 'RECALCULO_EN_CURSO';
  }
}

const estadoCol = (db) => db.collection(COLECCIONES.estado);

export const obtenerEstadoGuardado = (db) => estadoCol(db).findOne({ _id: ID_ESTADO });

export const marcarDesactualizado = async (db, motivo) => {
  await estadoCol(db).updateOne(
    { _id: ID_ESTADO },
    { $set: { desactualizado: true, motivo, desactualizadoEn: new Date() } },
    { upsert: true },
  );
};

export const adquirirBloqueo = async (db, { forzar = false } = {}) => {
  const libre = forzar
    ? { _id: ID_ESTADO }
    : {
      _id: ID_ESTADO,
      $or: [
        { recalculando: { $ne: true } },
        { inicio: { $lt: new Date(Date.now() - BLOQUEO_MAX_MS) } },
      ],
    };
  try {
    await estadoCol(db).updateOne(
      libre,
      { $set: { recalculando: true, inicio: new Date(), error: null } },
      { upsert: true },
    );
  } catch (error) {
    // El documento existe pero está bloqueado: el upsert intenta insertar el mismo _id.
    if (error.code === 11000) throw new RecalculoEnCursoError();
    throw error;
  }
};

const medir = async (tiempos, nombre, fn) => {
  const t0 = Date.now();
  const resultado = await fn();
  tiempos[nombre] = Date.now() - t0;
  return resultado;
};

/**
 * Recalcula todas las colecciones resumen desde la colección de flujos completa.
 * Requiere haber llamado antes a adquirirBloqueo(db). Es idempotente: cada ejecución
 * reescribe los documentos con una nueva `generacion` y borra los de generaciones previas.
 */
export const ejecutarRecalculo = async (db, {
  coleccionFlujos,
  log = () => {},
  maxTimeMS = MAX_TIME_RECALCULO_MS,
} = {}) => {
  const inicio = Date.now();
  const generacion = new ObjectId().toHexString();
  // Los flujos insertados después de este corte (ObjectId generado más tarde) los suma la
  // cola incremental; el recorrido completo solo cuenta los anteriores.
  const corte = ObjectId.createFromTime(Math.floor(inicio / 1000));
  const tiempos = {};

  try {
    await estadoCol(db).updateOne({ _id: ID_ESTADO }, { $set: { corteEnCurso: corte } });

    log(`[Resúmenes] Recorriendo ${coleccionFlujos} completa (un solo $facet → ${COLECCIONES.base})…`);
    await medir(tiempos, COLECCIONES.base, () => db
      .collection(coleccionFlujos)
      .aggregate(pipelineBase({ match: { _id: { $lt: corte } }, generacion }), {
        allowDiskUse: true,
        maxTimeMS,
        hint: { $natural: 1 },
      })
      .toArray());
    await db.collection(COLECCIONES.base).deleteMany({ generacion: { $ne: generacion } });
    log(`[Resúmenes] ${COLECCIONES.base}: ${tiempos[COLECCIONES.base]} ms`);

    for (const derivacion of DERIVACIONES) {
      await medir(tiempos, derivacion.destino, () => db
        .collection(COLECCIONES.base)
        .aggregate(pipelineDerivacion(derivacion, 'reemplazar', generacion), { allowDiskUse: true, maxTimeMS })
        .toArray());
      await db.collection(derivacion.destino).deleteMany({ generacion: { $ne: generacion } });
      log(`[Resúmenes] ${derivacion.destino}: ${tiempos[derivacion.destino]} ms`);
    }

    for (const { coleccion, key, name } of INDICES_RESUMEN) {
      await db.collection(coleccion).createIndex(key, { name });
    }

    const fin = new Date();
    const estado = {
      recalculando: false,
      generacion,
      corte,
      generadoEn: fin,
      duracionMs: fin.getTime() - inicio,
      tiemposMs: tiempos,
      desactualizado: false,
      motivo: null,
      insercionesIncrementales: 0,
      error: null,
    };
    await estadoCol(db).updateOne(
      { _id: ID_ESTADO },
      { $set: estado, $unset: { corteEnCurso: '' } },
    );
    eventosResumen.emit('actualizados', { tipo: 'recalculo', generadoEn: fin });
    return estado;
  } catch (error) {
    await estadoCol(db).updateOne(
      { _id: ID_ESTADO },
      { $set: { recalculando: false, error: error.message }, $unset: { corteEnCurso: '' } },
    );
    throw error;
  }
};

export const recalcularResumenes = async (db, opciones = {}) => {
  await adquirirBloqueo(db, opciones);
  return ejecutarRecalculo(db, opciones);
};

/**
 * Inicia un recálculo completo en segundo plano (para el endpoint de refresco). Lanza
 * RecalculoEnCursoError si ya hay uno en curso.
 */
export const iniciarRecalculo = async (db, opciones = {}) => {
  await adquirirBloqueo(db);
  ejecutarRecalculo(db, opciones).catch((error) => {
    console.error('[Resúmenes] El recálculo falló:', error.message);
  });
};

/**
 * Suma a los resúmenes los flujos insertados con los _id indicados. Ejecuta las mismas
 * agregaciones que el recálculo completo, pero solo sobre esos documentos (índice _id):
 * flujos_limpia → delta temporal → $merge en modo "sumar" sobre cada resumen.
 */
export const aplicarInserciones = async (db, ids, { coleccionFlujos } = {}) => {
  const estado = await obtenerEstadoGuardado(db);
  if (!estado?.generacion) return { aplicados: 0, sinResumenes: true };
  if (estado.recalculando) return { aplicados: 0, aplazado: true };

  const delta = `resumen_delta_${new ObjectId().toHexString()}`;
  try {
    await db.collection(coleccionFlujos)
      .aggregate(pipelineBase({ match: { _id: { $in: ids, $gte: estado.corte } }, destino: delta }))
      .toArray();

    const deltaCol = db.collection(delta);
    const [{ flujos = 0 } = {}] = await deltaCol
      .aggregate([{ $match: { dim: 'tiempo' } }, { $group: { _id: null, flujos: { $sum: '$flujos' } } }])
      .toArray();
    if (flujos === 0) return { aplicados: 0 };

    await deltaCol
      .aggregate([etapaMerge(COLECCIONES.base, 'sumar', { sumar: CAMPOS_BASE })])
      .toArray();
    for (const derivacion of DERIVACIONES) {
      await deltaCol.aggregate(pipelineDerivacion(derivacion, 'sumar')).toArray();
    }
    await estadoCol(db).updateOne(
      { _id: ID_ESTADO },
      { $inc: { insercionesIncrementales: flujos }, $set: { ultimoIncremento: new Date() } },
    );
    eventosResumen.emit('actualizados', { tipo: 'incremental', flujos });
    return { aplicados: flujos };
  } finally {
    await db.collection(delta).drop().catch(() => {});
  }
};

/**
 * Estado de los resúmenes para la API, comparando el total resumido con el tamaño actual
 * de la colección (estimatedDocumentCount usa metadatos, no recorre documentos).
 */
export const obtenerEstado = async (db, { coleccionFlujos } = {}) => {
  const [estado, general, totalColeccion] = await Promise.all([
    obtenerEstadoGuardado(db),
    db.collection(COLECCIONES.general).findOne({ _id: ID_GENERAL }, { projection: { totalFlujos: 1 } }),
    db.collection(coleccionFlujos).estimatedDocumentCount(),
  ]);
  const totalResumido = general?.totalFlujos ?? null;
  return {
    disponible: Boolean(estado?.generacion && general),
    recalculando: Boolean(estado?.recalculando),
    generadoEn: estado?.generadoEn ?? null,
    duracionMs: estado?.duracionMs ?? null,
    tiemposMs: estado?.tiemposMs ?? null,
    insercionesIncrementales: estado?.insercionesIncrementales ?? 0,
    ultimoIncremento: estado?.ultimoIncremento ?? null,
    desactualizado: Boolean(estado?.desactualizado) || (totalResumido !== null && totalResumido !== totalColeccion),
    motivo: estado?.motivo
      ?? (totalResumido !== null && totalResumido !== totalColeccion
        ? 'El total resumido no coincide con el tamaño de la colección.'
        : null),
    totalResumido,
    totalColeccion,
    error: estado?.error ?? null,
  };
};

/**
 * Cola que agrupa los _id insertados que llegan por el Change Stream y los aplica por lotes,
 * uno a la vez. Si hay un recálculo en curso, conserva los _id y reintenta después.
 */
export const crearColaIncremental = ({
  aplicar,
  alDesbordar = () => {},
  alFallar = () => {},
  esperaMs = 1_000,
  reintentoMs = 5_000,
  maxLote = 5_000,
  maxPendientes = 200_000,
}) => {
  let pendientes = [];
  let timer = null;
  let trabajando = null;
  let detenida = false;

  const programar = (ms) => {
    if (detenida || timer) return;
    timer = setTimeout(() => {
      timer = null;
      trabajando = vaciar().finally(() => { trabajando = null; });
    }, ms);
  };

  const vaciar = async () => {
    if (!pendientes.length) return;
    const lote = pendientes.splice(0, maxLote);
    try {
      const resultado = await aplicar(lote);
      if (resultado?.aplazado) {
        pendientes = lote.concat(pendientes);
        programar(reintentoMs);
        return;
      }
    } catch (error) {
      alFallar(error, lote);
    }
    if (pendientes.length) programar(0);
  };

  return {
    agregar(id) {
      if (detenida) return;
      if (pendientes.length >= maxPendientes) {
        pendientes = [];
        alDesbordar();
        return;
      }
      pendientes.push(id);
      if (!trabajando) programar(pendientes.length >= maxLote ? 0 : esperaMs);
    },
    pendientes: () => pendientes.length,
    async detener() {
      detenida = true;
      clearTimeout(timer);
      timer = null;
      await trabajando;
    },
  };
};

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

// Campos de un flujo que usan los resúmenes (los que lee proyeccionFlujo en resumenPipelines.js).
const CAMPOS_RESUMIDOS = ['Label', 'Timestamp', 'Protocol', 'Source IP', 'Destination IP', 'Destination Port', 'Flow Bytes/s'];

/** Reduce un flujo del Change Stream a _id y los campos resumidos, para no guardar 88 campos en la cola. */
export const reducirFlujo = (doc) => Object.fromEntries(
  ['_id', ...CAMPOS_RESUMIDOS].filter((campo) => campo in doc).map((campo) => [campo, doc[campo]]),
);

// $documents evalúa expresiones: $literal evita que un valor como "$x" se lea como un campo.
const comoDocumentos = (docs) => docs.map((doc) => Object.fromEntries(
  CAMPOS_RESUMIDOS.filter((campo) => campo in doc).map((campo) => [campo, { $literal: doc[campo] }]),
));

/**
 * Ejecuta pipelineBase sobre los documentos dados (no sobre flujos_limpia) hacia un delta
 * temporal y lo suma a resumen_base y a cada resumen. Con signo -1 el delta se resta.
 */
const sumarDelta = async (db, docs, signo) => {
  const delta = `resumen_delta_${new ObjectId().toHexString()}`;
  try {
    await db.aggregate([{ $documents: comoDocumentos(docs) }, ...pipelineBase({ destino: delta })]).toArray();
    const deltaCol = db.collection(delta);
    if (signo < 0) {
      await deltaCol.updateMany({}, [{
        $set: Object.fromEntries(CAMPOS_BASE.map((campo) => [campo, { $multiply: [`$${campo}`, -1] }])),
      }]);
    }
    await deltaCol
      .aggregate([etapaMerge(COLECCIONES.base, 'sumar', { sumar: CAMPOS_BASE })])
      .toArray();
    for (const derivacion of DERIVACIONES) {
      await deltaCol.aggregate(pipelineDerivacion(derivacion, 'sumar')).toArray();
    }
  } finally {
    await db.collection(delta).drop().catch(() => {});
  }
};

// Tras restar: quita los documentos que quedaron en 0 y recalcula desde resumen_base las
// etiquetas de las IP de origen tocadas (el modo "sumar" solo une etiquetas, no las quita).
const limpiarRestados = async (db, ips) => {
  await db.collection(COLECCIONES.base).deleteMany({ flujos: 0 });
  for (const { destino, sumar } of DERIVACIONES) {
    if (destino !== COLECCIONES.general) await db.collection(destino).deleteMany({ [sumar[0]]: 0 });
  }
  if (!ips.length) return;
  await db.collection(COLECCIONES.base).aggregate([
    { $match: { dim: 'ipOrigen', ip: { $in: ips } } },
    { $group: { _id: '$ip', etiquetas: { $addToSet: '$label' } } },
    { $set: { etiquetas: { $sortArray: { input: '$etiquetas', sortBy: 1 } } } },
    { $merge: { into: COLECCIONES.ipsOrigen, on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } },
  ]).toArray();
};

/**
 * Aplica a los resúmenes un lote de cambios del Change Stream sin recorrer la colección:
 * cada cambio es { signo: 1 | -1, doc, insercion? }. Una inserción suma el documento; un
 * update/replace resta la pre-image y suma la post-image; un delete resta la pre-image.
 * Las agregaciones son las mismas del recálculo completo, ejecutadas con $documents.
 */
export const aplicarCambios = async (db, cambios) => {
  const estado = await obtenerEstadoGuardado(db);
  if (!estado?.generacion) return { aplicados: 0, sinResumenes: true };
  if (estado.recalculando) return { aplicados: 0, aplazado: true };

  // Una inserción con _id anterior al corte del último recálculo ya está contada.
  const corte = estado.corte?.toHexString() ?? '';
  const vigentes = cambios.filter(({ insercion, doc }) => !insercion
    || (doc._id instanceof ObjectId && doc._id.toHexString() >= corte));
  if (!vigentes.length) return { aplicados: 0 };

  const restados = vigentes.filter((cambio) => cambio.signo < 0).map((cambio) => cambio.doc);
  const sumados = vigentes.filter((cambio) => cambio.signo > 0).map((cambio) => cambio.doc);
  if (restados.length) await sumarDelta(db, restados, -1);
  if (sumados.length) await sumarDelta(db, sumados, 1);
  if (restados.length) {
    await limpiarRestados(db, [...new Set(restados.map((doc) => doc['Source IP']).filter((ip) => ip != null))]);
  }

  const flujos = sumados.length - restados.length;
  await estadoCol(db).updateOne(
    { _id: ID_ESTADO },
    { $inc: { insercionesIncrementales: flujos }, $set: { ultimoIncremento: new Date() } },
  );
  eventosResumen.emit('actualizados', { tipo: 'incremental', flujos, cambios: vigentes.length });
  return { aplicados: vigentes.length };
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
 * Cola que agrupa los cambios que llegan por el Change Stream y los aplica por lotes, uno a
 * la vez y en orden. Si hay un recálculo en curso, los conserva y reintenta después.
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

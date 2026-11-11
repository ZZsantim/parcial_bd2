import {
  getDashboardAnalitica,
  getDashboardComparacion,
  getDashboardInformes,
  getDashboardResumen,
  getDashboardSeries,
  getDashboardTopIps,
  getEstadoResumenes,
  refrescarResumenes,
} from '../services/informeService.js';

const MENSAJE_SIN_RESUMENES = 'Los resúmenes del dataset aún no se han generado. Ejecuta "npm run db:resumenes".';

const responderError = (res, error, contexto, mensaje) => {
  if (error.code === 'RESUMENES_NO_DISPONIBLES') {
    return res.status(503).json({ message: MENSAJE_SIN_RESUMENES });
  }
  if (error.code === 50 || error.codeName === 'MaxTimeMSExpired') {
    return res.status(504).json({
      message: 'La consulta sobre flujos_limpia superó el tiempo máximo. Acota los filtros (label, protocol, desde, hasta).',
    });
  }
  console.error(`[API] Error al obtener ${contexto}:`, error);
  return res.status(500).json({ message: mensaje });
};

const parseLimit = (value, defaultValue, maximum) => {
  const parsed = Number(value ?? defaultValue);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
};

const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/;
const MENSAJE_FECHA = 'debe tener formato "YYYY-MM-DD HH:MM:SS" o "YYYY-MM-DD" y ser una fecha válida';

// Valida una fecha y la normaliza al formato de Timestamp. Con solo fecha, "hasta" abarca el día entero.
const parseFecha = (value, finDelDia) => {
  const partes = typeof value === 'string' ? FORMATO_FECHA.exec(value) : null;
  if (!partes) return null;
  const [, anio, mes, dia, hora, minuto, segundo] = partes;
  const fecha = `${anio}-${mes}-${dia} ${hora === undefined ? (finDelDia ? '23:59:59' : '00:00:00') : `${hora}:${minuto}:${segundo}`}`;
  const real = new Date(`${fecha.replace(' ', 'T')}Z`);
  return !Number.isNaN(real.getTime()) && real.toISOString().slice(0, 19).replace('T', ' ') === fecha ? fecha : null;
};

/**
 * Filtros opcionales de los informes: label (valor exacto), protocol (entero 0–255),
 * desde y hasta. Devuelve { filtros } o { error } con el mensaje para un 400.
 */
export const parseFiltros = (query) => {
  const filtros = {};
  if (query.label !== undefined) {
    if (typeof query.label !== 'string' || query.label.length < 1 || query.label.length > 60) {
      return { error: 'El parámetro label debe ser un texto de 1 a 60 caracteres (valor exacto de Label).' };
    }
    filtros.label = query.label;
  }
  if (query.protocol !== undefined) {
    if (typeof query.protocol !== 'string' || !/^\d{1,3}$/.test(query.protocol) || Number(query.protocol) > 255) {
      return { error: 'El parámetro protocol debe ser un entero entre 0 y 255.' };
    }
    filtros.protocol = Number(query.protocol);
  }
  for (const [nombre, finDelDia] of [['desde', false], ['hasta', true]]) {
    if (query[nombre] === undefined) continue;
    const fecha = parseFecha(query[nombre], finDelDia);
    if (!fecha) return { error: `El parámetro ${nombre} ${MENSAJE_FECHA}.` };
    filtros[nombre] = fecha;
  }
  if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) {
    return { error: 'El parámetro desde no puede ser posterior a hasta.' };
  }
  return { filtros };
};

/** Periodos A y B de la comparación: desdeA, hastaA, desdeB y hastaB son obligatorios. */
export const parseComparacion = (query) => {
  const periodos = {};
  for (const sufijo of ['A', 'B']) {
    const desde = parseFecha(query[`desde${sufijo}`], false);
    const hasta = parseFecha(query[`hasta${sufijo}`], true);
    if (!desde || !hasta) {
      return { error: `Los parámetros desde${sufijo} y hasta${sufijo} son obligatorios y cada uno ${MENSAJE_FECHA}.` };
    }
    if (desde > hasta) return { error: `El parámetro desde${sufijo} no puede ser posterior a hasta${sufijo}.` };
    // La comparación se calcula por horas completas (cubo de resumen_base).
    if (!desde.endsWith(':00:00') || !hasta.endsWith(':59:59')) {
      return { error: `El periodo ${sufijo} debe ir por horas completas: desde${sufijo} en HH:00:00 y hasta${sufijo} en HH:59:59 (o solo la fecha).` };
    }
    periodos[sufijo] = { desde, hasta };
  }
  return { a: periodos.A, b: periodos.B };
};

export const getResumen = async (req, res) => {
  try {
    const { filtros, error } = parseFiltros(req.query);
    if (error) return res.status(400).json({ message: error });
    const data = await getDashboardResumen(filtros);
    res.status(200).json(data);
  } catch (error) {
    responderError(res, error, 'resumen', 'Error al obtener el resumen del dashboard.');
  }
};

export const getTopIps = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 5, 100);
    if (limit === null) {
      return res.status(400).json({ message: 'El parámetro limit debe ser un entero entre 1 y 100.' });
    }
    const { filtros, error } = parseFiltros(req.query);
    if (error) return res.status(400).json({ message: error });
    const data = await getDashboardTopIps(limit, filtros);
    res.status(200).json(data);
  } catch (error) {
    responderError(res, error, 'IPs principales', 'Error al obtener las IPs más activas.');
  }
};

export const getSeries = async (req, res) => {
  try {
    const days = parseLimit(req.query.days, 7, 90);
    if (days === null) {
      return res.status(400).json({ message: 'El parámetro days debe ser un entero entre 1 y 90.' });
    }
    const { filtros, error } = parseFiltros(req.query);
    if (error) return res.status(400).json({ message: error });
    const data = await getDashboardSeries(days, filtros);
    res.status(200).json(data);
  } catch (error) {
    responderError(res, error, 'serie temporal', 'Error al obtener la serie temporal.');
  }
};

export const getAnalitica = async (req, res) => {
  try {
    const days = parseLimit(req.query.days, 7, 90);
    const limit = parseLimit(req.query.limit, 8, 30);
    if (days === null || limit === null) {
      return res.status(400).json({
        message: 'Los parámetros days (1–90) y limit (1–30) deben ser enteros válidos.',
      });
    }
    const { filtros, error } = parseFiltros(req.query);
    if (error) return res.status(400).json({ message: error });
    const data = await getDashboardAnalitica(days, limit, filtros);
    res.status(200).json(data);
  } catch (error) {
    responderError(res, error, 'analítica del dashboard', 'Error al obtener la analítica del dashboard.');
  }
};

export const getComparacion = async (req, res) => {
  try {
    const { a, b, error } = parseComparacion(req.query);
    if (error) return res.status(400).json({ message: error });
    res.status(200).json(await getDashboardComparacion(a, b));
  } catch (error) {
    responderError(res, error, 'comparación de periodos', 'Error al comparar los periodos.');
  }
};

export const getInformes = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    if (limit === null) {
      return res.status(400).json({ message: 'El parámetro limit debe ser un entero entre 1 y 100.' });
    }
    const { filtros, error } = parseFiltros(req.query);
    if (error) return res.status(400).json({ message: error });
    const data = await getDashboardInformes(limit, filtros);
    res.status(200).json(data);
  } catch (error) {
    responderError(res, error, 'informes', 'Error al obtener los informes.');
  }
};

export const getEstado = async (_req, res) => {
  try {
    res.status(200).json(await getEstadoResumenes());
  } catch (error) {
    console.error('[API] Error al obtener el estado de los resúmenes:', error);
    res.status(500).json({ message: 'Error al obtener el estado de los resúmenes.' });
  }
};

export const postRefrescar = async (_req, res) => {
  try {
    await refrescarResumenes();
    res.status(202).json({
      message: 'Recálculo completo iniciado. Consulta /api/informes/resumenes/estado para ver el avance.',
    });
  } catch (error) {
    if (error.code === 'RECALCULO_EN_CURSO') {
      return res.status(409).json({ message: error.message });
    }
    console.error('[API] Error al iniciar el recálculo de resúmenes:', error);
    res.status(500).json({ message: 'No se pudo iniciar el recálculo de resúmenes.' });
  }
};

export default {
  getEstado,
  postRefrescar,
  getResumen,
  getTopIps,
  getSeries,
  getAnalitica,
  getComparacion,
  getInformes,
};

import {
  getDashboardAnalitica,
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
  console.error(`[API] Error al obtener ${contexto}:`, error);
  return res.status(500).json({ message: mensaje });
};

const parseLimit = (value, defaultValue, maximum) => {
  const parsed = Number(value ?? defaultValue);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
};

export const getResumen = async (_req, res) => {
  try {
    const data = await getDashboardResumen();
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
    const data = await getDashboardTopIps(limit);
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
    const data = await getDashboardSeries(days);
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
    const data = await getDashboardAnalitica(days, limit);
    res.status(200).json(data);
  } catch (error) {
    responderError(res, error, 'analítica del dashboard', 'Error al obtener la analítica del dashboard.');
  }
};

export const getInformes = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    if (limit === null) {
      return res.status(400).json({ message: 'El parámetro limit debe ser un entero entre 1 y 100.' });
    }
    const data = await getDashboardInformes(limit);
    res.status(200).json(data);
  } catch (error) {
    console.error('[API] Error al obtener informes:', error);
    res.status(500).json({ message: 'Error al obtener los informes.' });
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
  getInformes,
};

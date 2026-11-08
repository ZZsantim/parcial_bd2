import {
  getDashboardAnalitica,
  getDashboardInformes,
  getDashboardResumen,
  getDashboardSeries,
  getDashboardTopIps,
} from '../services/informeService.js';

const parseLimit = (value, defaultValue, maximum) => {
  const parsed = Number(value ?? defaultValue);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
};

export const getResumen = async (_req, res) => {
  try {
    const data = await getDashboardResumen();
    res.status(200).json(data);
  } catch (error) {
    console.error('[API] Error al obtener resumen:', error);
    res.status(500).json({ message: 'Error al obtener el resumen del dashboard.' });
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
    console.error('[API] Error al obtener IPs principales:', error);
    res.status(500).json({ message: 'Error al obtener las IPs más activas.' });
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
    console.error('[API] Error al obtener serie temporal:', error);
    res.status(500).json({ message: 'Error al obtener la serie temporal.' });
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
    console.error('[API] Error al obtener analítica del dashboard:', error);
    res.status(500).json({ message: 'Error al obtener la analítica del dashboard.' });
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

export default {
  getResumen,
  getTopIps,
  getSeries,
  getAnalitica,
  getInformes,
};

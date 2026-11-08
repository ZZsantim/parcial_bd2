import {
  getAnalitica,
  getInformes,
  getResumen,
  getSeries,
  getTopIps,
} from '../repositories/informeRepository.js';

export const getDashboardResumen = async () => getResumen();

export const getDashboardTopIps = async (limit = 5) => getTopIps(limit);

export const getDashboardSeries = async (days = 7) => getSeries(days);

export const getDashboardAnalitica = async (days = 7, limit = 8) => getAnalitica(days, limit);

export const getDashboardInformes = async (limit = 20) => getInformes(limit);

export default {
  getDashboardResumen,
  getDashboardTopIps,
  getDashboardSeries,
  getDashboardAnalitica,
  getDashboardInformes,
};

import { flowsCollectionName, getDB } from '../config/db.js';
import {
  getAnalitica,
  getInformes,
  getResumen,
  getSeries,
  getTopIps,
} from '../repositories/informeRepository.js';
import { iniciarRecalculo, obtenerEstado } from './resumenService.js';

export const getDashboardResumen = async () => getResumen();

export const getDashboardTopIps = async (limit = 5) => getTopIps(limit);

export const getDashboardSeries = async (days = 7) => getSeries(days);

export const getDashboardAnalitica = async (days = 7, limit = 8) => getAnalitica(days, limit);

export const getDashboardInformes = async (limit = 20) => getInformes(limit);

export const getEstadoResumenes = async () => obtenerEstado(getDB(), { coleccionFlujos: flowsCollectionName });

export const refrescarResumenes = async () => iniciarRecalculo(getDB(), {
  coleccionFlujos: flowsCollectionName,
  log: (mensaje) => console.log(mensaje),
});

export default {
  getDashboardResumen,
  getDashboardTopIps,
  getDashboardSeries,
  getDashboardAnalitica,
  getDashboardInformes,
  getEstadoResumenes,
  refrescarResumenes,
};

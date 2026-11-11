import { flowsCollectionName, getDB } from '../config/db.js';
import {
  getAnalitica,
  getComparacion,
  getInformes,
  getResumen,
  getSeries,
  getTopIps,
} from '../repositories/informeRepository.js';
import { iniciarRecalculo, obtenerEstado } from './resumenService.js';

export const getDashboardResumen = async (filtros = {}) => getResumen(undefined, filtros);

export const getDashboardTopIps = async (limit = 5, filtros = {}) => getTopIps(limit, undefined, filtros);

export const getDashboardSeries = async (days = 7, filtros = {}) => getSeries(days, undefined, filtros);

export const getDashboardAnalitica = async (days = 7, limit = 8, filtros = {}) => (
  getAnalitica(days, limit, undefined, filtros)
);

export const getDashboardComparacion = async (a, b) => getComparacion(a, b);

export const getDashboardInformes = async (limit = 20, filtros = {}) => getInformes(limit, filtros);

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
  getDashboardComparacion,
  getDashboardInformes,
  getEstadoResumenes,
  refrescarResumenes,
};

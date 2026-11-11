import { Router } from 'express';
import {
  getAnalitica,
  getComparacion,
  getEstado,
  getInformes,
  getResumen,
  getSeries,
  getTopIps,
  postRefrescar,
} from '../controllers/informeController.js';

const router = Router();

router.get('/', getInformes);
router.get('/resumen', getResumen);
router.get('/top-ips', getTopIps);
router.get('/series', getSeries);
router.get('/analitica', getAnalitica);
router.get('/comparacion', getComparacion);
router.get('/resumenes/estado', getEstado);
router.post('/resumenes/refrescar', postRefrescar);

export default router;

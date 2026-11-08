import { Router } from 'express';
import {
  getAnalitica,
  getInformes,
  getResumen,
  getSeries,
  getTopIps,
} from '../controllers/informeController.js';

const router = Router();

router.get('/', getInformes);
router.get('/resumen', getResumen);
router.get('/top-ips', getTopIps);
router.get('/series', getSeries);
router.get('/analitica', getAnalitica);

export default router;

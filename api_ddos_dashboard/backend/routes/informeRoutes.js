import { Router } from 'express';
import {
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

export default router;

import { Router } from 'express';
import { consultar } from '../controllers/consultaController.js';

const router = Router();

router.post('/', consultar);

export default router;

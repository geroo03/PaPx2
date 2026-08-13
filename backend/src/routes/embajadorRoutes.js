import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware.js';
import {
  getDashboard,
  vincularReferido,
  solicitarRetiro,
  confirmarPago,
  rechazarRetiro,
} from '../controllers/embajadorController.js';

const router = Router();

// Embajador
router.get('/dashboard',          requireAuth, getDashboard);
router.post('/vincular-referido', requireAuth, vincularReferido);
router.post('/solicitar-retiro',  requireAuth, solicitarRetiro);

// Admin
router.patch('/retiro/:id/pagar',   requireAuth, confirmarPago);
router.patch('/retiro/:id/rechazar',requireAuth, rechazarRetiro);

export default router;

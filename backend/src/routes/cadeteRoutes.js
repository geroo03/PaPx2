import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middlewares/authMiddleware.js';
import {
  actualizarUbicacion,
  getEfectivo,
  solicitarLiquidacion,
  validarReferido,
  confirmarLiquidacion,
  rechazarLiquidacion,
  adminActualizarEfectivo,
  adminListaCadetes,
} from '../controllers/cadeteController.js';

const router = Router();

// Cadete
router.post('/actualizar-ubicacion',           requireAuth, actualizarUbicacion);
router.get('/efectivo',                        requireAuth, getEfectivo);
router.post('/solicitar-liquidacion',          requireAuth, solicitarLiquidacion);
router.post('/validar-referido',               requireAuth, validarReferido);

// Admin
router.patch('/liquidacion/:id/confirmar',     requireAdmin, confirmarLiquidacion);
router.patch('/liquidacion/:id/rechazar',      requireAdmin, rechazarLiquidacion);
router.patch('/:id/efectivo',                  requireAdmin, adminActualizarEfectivo);
router.get('/admin/lista',                     requireAdmin, adminListaCadetes);

export default router;

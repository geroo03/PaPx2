import { Router } from 'express';
import { requireAdmin } from '../middlewares/authMiddleware.js';
import {
  getDepositos,
  registrarDeposito,
  getHistorialDepositos,
} from '../controllers/adminController.js';

const router = Router();

// Todo este router es solo-admin: requireAdmin ya envuelve a requireAuth, así
// que valida el JWT y además que perfiles.rol = 'admin'.
router.get('/depositos',           requireAdmin, getDepositos);
router.post('/depositos',          requireAdmin, registrarDeposito);
router.get('/depositos/historial', requireAdmin, getHistorialDepositos);

export default router;

import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { actualizarUbicacion } from '../controllers/cadeteController.js';

const router = Router();

// GPS: el cadete reporta su posición periódicamente
router.post('/actualizar-ubicacion', requireAuth, actualizarUbicacion);

export default router;

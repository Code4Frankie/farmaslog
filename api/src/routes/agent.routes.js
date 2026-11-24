import { Router } from 'express';
import { ROLES } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { agentVisitsSchema } from '../validators/index.js';
import { agentSummary, visitQueue } from '../services/agent.service.js';

// The field agent's own console: what they have registered and which farms are waiting for a visit.
const router = Router();
router.use(authenticate, authorize(ROLES.FIELD_AGENT));

router.get('/summary', asyncHandler(async (req, res) => { res.json(await agentSummary(req.user)); }));
router.get('/visits', validate(agentVisitsSchema, 'query'), asyncHandler(async (req, res) => { res.json(await visitQueue(req.user, req.query)); }));

export default router;

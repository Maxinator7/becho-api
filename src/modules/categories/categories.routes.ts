import { Router, Request, Response, NextFunction } from 'express';
import { CategoriesService } from './categories.service.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { UserRole } from '../../common/types/enums.js';

export const categoriesRouter = Router();

// Public: Get categories tree
categoriesRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await CategoriesService.getCategoriesTree();
    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
});

// Public: Get attributes for category
categoriesRouter.get('/:id/attributes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attributes = await CategoriesService.getCategoryAttributes(req.params.id);
    res.json({ success: true, data: attributes });
  } catch (err) {
    next(err);
  }
});

// Admin: Create category
categoriesRouter.post('/admin', authenticateToken, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await CategoriesService.createCategory(req.body);
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
});

// Admin: Add attribute definition
categoriesRouter.post('/admin/:id/attributes', authenticateToken, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attribute = await CategoriesService.addAttributeDefinition({
      ...req.body,
      categoryId: req.params.id,
    });
    res.status(201).json({ success: true, data: attribute });
  } catch (err) {
    next(err);
  }
});

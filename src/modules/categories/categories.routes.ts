import { Router } from 'express';
import { z } from 'zod';
import { CategoriesService } from './categories.service.js';
import { authenticateToken, requireRole } from '../../common/middleware/auth-guard.js';
import { asyncHandler as wrap } from '../../common/async-handler.js';
import { id } from '../../common/validation.js';
import { AttributeDataType, UserRole } from '../../common/types/enums.js';

export const categoriesRouter = Router();

const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by dashes');

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug,
  parentId: id.optional(),
  sortOrder: z.number().int().optional(),
});

const createAttributeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug,
  dataType: z.nativeEnum(AttributeDataType),
  isRequired: z.boolean().optional(),
  isFilterable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  validationConfig: z.record(z.unknown()).optional(),
  options: z.array(z.object({ label: z.string().trim().min(1), value: z.string().trim().min(1) })).optional(),
});

categoriesRouter.get('/', wrap(async (_req, res) => {
  res.json({ success: true, data: await CategoriesService.getCategoriesTree() });
}));

categoriesRouter.get('/:id/attributes', wrap(async (req, res) => {
  res.json({ success: true, data: await CategoriesService.getCategoryAttributes(id.parse(req.params.id)) });
}));

categoriesRouter.post('/admin', authenticateToken, requireRole(UserRole.ADMIN), wrap(async (req, res) => {
  res.status(201).json({ success: true, data: await CategoriesService.createCategory(createCategorySchema.parse(req.body)) });
}));

categoriesRouter.post('/admin/:id/attributes', authenticateToken, requireRole(UserRole.ADMIN), wrap(async (req, res) => {
  const attribute = await CategoriesService.addAttributeDefinition({
    ...createAttributeSchema.parse(req.body),
    categoryId: id.parse(req.params.id),
  });
  res.status(201).json({ success: true, data: attribute });
}));

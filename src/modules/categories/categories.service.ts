import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AttributeDataType } from '../../common/types/enums.js';

// Category data is created by `npm run seed` (src/seed.ts) or the admin endpoints.
export class CategoriesService {
  static async getCategoriesTree() {
    return prisma.category.findMany({
      where: { parentId: null, isActive: true },
      include: { children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  static async getCategoryAttributes(categoryId: string) {
    return prisma.attributeDefinition.findMany({
      where: { categoryId, isActive: true },
      include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  static async createCategory(data: { name: string; slug: string; parentId?: string; sortOrder?: number }) {
    return prisma.category.create({ data });
  }

  static async addAttributeDefinition(data: {
    categoryId: string;
    name: string;
    slug: string;
    dataType: AttributeDataType;
    isRequired?: boolean;
    isFilterable?: boolean;
    sortOrder?: number;
    validationConfig?: Record<string, unknown>;
    options?: { label: string; value: string }[];
  }) {
    const { options, validationConfig, ...attrData } = data;
    return prisma.attributeDefinition.create({
      data: {
        ...attrData,
        validationConfig: (validationConfig as Prisma.InputJsonValue) ?? undefined,
        options: options?.length
          ? { create: options.map((opt, idx) => ({ label: opt.label, value: opt.value, sortOrder: idx + 1 })) }
          : undefined,
      },
      include: { options: true },
    });
  }
}

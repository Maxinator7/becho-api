import { prisma } from '../../common/prisma.js';
import { AttributeDataType } from '../../common/types/enums.js';

export class CategoriesService {
  static async seedDefaultsIfEmpty() {
    const count = await prisma.category.count();
    if (count === 0) {
      // 1. Electronics Top Category
      const electronics = await prisma.category.create({
        data: { name: 'Electronics', slug: 'electronics', sortOrder: 1 },
      });

      const mobiles = await prisma.category.create({
        data: { name: 'Mobile Phones', slug: 'mobile-phones', parentId: electronics.id, sortOrder: 1 },
      });

      // Add attributes for Mobiles
      const brandAttr = await prisma.attributeDefinition.create({
        data: {
          categoryId: mobiles.id,
          name: 'Brand',
          slug: 'brand',
          dataType: AttributeDataType.SELECT,
          isRequired: true,
          isFilterable: true,
          sortOrder: 1,
        },
      });

      await prisma.attributeOption.createMany({
        data: [
          { attributeDefinitionId: brandAttr.id, label: 'Apple', value: 'apple', sortOrder: 1 },
          { attributeDefinitionId: brandAttr.id, label: 'Samsung', value: 'samsung', sortOrder: 2 },
          { attributeDefinitionId: brandAttr.id, label: 'Google', value: 'google', sortOrder: 3 },
          { attributeDefinitionId: brandAttr.id, label: 'OnePlus', value: 'oneplus', sortOrder: 4 },
        ],
      });

      const storageAttr = await prisma.attributeDefinition.create({
        data: {
          categoryId: mobiles.id,
          name: 'Storage Capacity',
          slug: 'storage-capacity',
          dataType: AttributeDataType.SELECT,
          isRequired: true,
          isFilterable: true,
          sortOrder: 2,
        },
      });

      await prisma.attributeOption.createMany({
        data: [
          { attributeDefinitionId: storageAttr.id, label: '64 GB', value: '64gb', sortOrder: 1 },
          { attributeDefinitionId: storageAttr.id, label: '128 GB', value: '128gb', sortOrder: 2 },
          { attributeDefinitionId: storageAttr.id, label: '256 GB', value: '256gb', sortOrder: 3 },
          { attributeDefinitionId: storageAttr.id, label: '512 GB', value: '512gb', sortOrder: 4 },
        ],
      });

      // 2. Vehicles Top Category
      const vehicles = await prisma.category.create({
        data: { name: 'Vehicles', slug: 'vehicles', sortOrder: 2 },
      });

      const cars = await prisma.category.create({
        data: { name: 'Cars', slug: 'cars', parentId: vehicles.id, sortOrder: 1 },
      });

      const yearAttr = await prisma.attributeDefinition.create({
        data: {
          categoryId: cars.id,
          name: 'Model Year',
          slug: 'model-year',
          dataType: AttributeDataType.NUMBER,
          isRequired: true,
          isFilterable: true,
          sortOrder: 1,
        },
      });

      const fuelAttr = await prisma.attributeDefinition.create({
        data: {
          categoryId: cars.id,
          name: 'Fuel Type',
          slug: 'fuel-type',
          dataType: AttributeDataType.SELECT,
          isRequired: true,
          isFilterable: true,
          sortOrder: 2,
        },
      });

      await prisma.attributeOption.createMany({
        data: [
          { attributeDefinitionId: fuelAttr.id, label: 'Petrol', value: 'petrol', sortOrder: 1 },
          { attributeDefinitionId: fuelAttr.id, label: 'Diesel', value: 'diesel', sortOrder: 2 },
          { attributeDefinitionId: fuelAttr.id, label: 'Electric', value: 'electric', sortOrder: 3 },
          { attributeDefinitionId: fuelAttr.id, label: 'Hybrid', value: 'hybrid', sortOrder: 4 },
        ],
      });
    }
  }

  static async getCategoriesTree() {
    await this.seedDefaultsIfEmpty();
    return prisma.category.findMany({
      where: { parentId: null, isActive: true },
      include: {
        children: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  static async getCategoryAttributes(categoryId: string) {
    return prisma.attributeDefinition.findMany({
      where: { categoryId, isActive: true },
      include: {
        options: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
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
    options?: { label: string; value: string }[];
  }) {
    const { options, ...attrData } = data;
    const attribute = await prisma.attributeDefinition.create({
      data: attrData,
    });

    if (options && options.length > 0) {
      await prisma.attributeOption.createMany({
        data: options.map((opt, idx) => ({
          attributeDefinitionId: attribute.id,
          label: opt.label,
          value: opt.value,
          sortOrder: idx + 1,
        })),
      });
    }

    return prisma.attributeDefinition.findUnique({
      where: { id: attribute.id },
      include: { options: true },
    });
  }
}

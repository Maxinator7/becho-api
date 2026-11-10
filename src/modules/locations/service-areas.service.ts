import { prisma } from '../../common/prisma.js';

// Service areas are created by `npm run seed` (src/seed.ts) or the admin endpoints.
export class ServiceAreasService {
  static async getActiveServiceAreas() {
    return prisma.serviceArea.findMany({
      where: { isActive: true },
      orderBy: [{ countryCode: 'asc' }, { stateName: 'asc' }, { cityName: 'asc' }],
    });
  }

  static async getAllServiceAreasAdmin() {
    return prisma.serviceArea.findMany({
      orderBy: [{ countryCode: 'asc' }, { stateName: 'asc' }, { cityName: 'asc' }],
    });
  }

  static async createServiceArea(data: {
    countryCode: string;
    stateCode: string;
    stateName: string;
    cityCode: string;
    cityName: string;
    isActive?: boolean;
    buyingEnabled?: boolean;
    sellingEnabled?: boolean;
  }) {
    return prisma.serviceArea.create({ data });
  }

  static async updateServiceArea(id: string, data: { isActive?: boolean; buyingEnabled?: boolean; sellingEnabled?: boolean }) {
    return prisma.serviceArea.update({ where: { id }, data });
  }
}

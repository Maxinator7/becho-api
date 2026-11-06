import { prisma } from '../../common/prisma.js';

export const DEFAULT_SERVICE_AREAS = [
  { countryCode: 'US', stateCode: 'NY', stateName: 'New York', cityCode: 'NYC', cityName: 'New York City', isActive: true, buyingEnabled: true, sellingEnabled: true },
  { countryCode: 'US', stateCode: 'CA', stateName: 'California', cityCode: 'LA', cityName: 'Los Angeles', isActive: true, buyingEnabled: true, sellingEnabled: true },
  { countryCode: 'US', stateCode: 'IL', stateName: 'Illinois', cityCode: 'CHI', cityName: 'Chicago', isActive: true, buyingEnabled: true, sellingEnabled: true },
  { countryCode: 'IN', stateCode: 'MH', stateName: 'Maharashtra', cityCode: 'MUM', cityName: 'Mumbai', isActive: true, buyingEnabled: true, sellingEnabled: true },
  { countryCode: 'IN', stateCode: 'KA', stateName: 'Karnataka', cityCode: 'BLR', cityName: 'Bengaluru', isActive: true, buyingEnabled: true, sellingEnabled: true },
];

export class ServiceAreasService {
  static async seedDefaultsIfEmpty() {
    const count = await prisma.serviceArea.count();
    if (count === 0) {
      for (const area of DEFAULT_SERVICE_AREAS) {
        await prisma.serviceArea.create({ data: area });
      }
    }
  }

  static async getActiveServiceAreas() {
    await this.seedDefaultsIfEmpty();
    return prisma.serviceArea.findMany({
      where: { isActive: true },
      orderBy: [{ stateName: 'asc' }, { cityName: 'asc' }],
    });
  }

  static async getAllServiceAreasAdmin() {
    await this.seedDefaultsIfEmpty();
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

  static async updateServiceArea(id: string, data: {
    isActive?: boolean;
    buyingEnabled?: boolean;
    sellingEnabled?: boolean;
  }) {
    return prisma.serviceArea.update({
      where: { id },
      data,
    });
  }
}

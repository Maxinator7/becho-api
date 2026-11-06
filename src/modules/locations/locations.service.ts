import { prisma } from '../../common/prisma.js';
import { ApiError } from '../../common/errors/api-error.js';
import { LocationSource } from '../../common/types/enums.js';

export interface SetLocationInput {
  countryCode: string;
  stateCode: string;
  stateName: string;
  cityName: string;
  cityId?: string;
  latitude?: number;
  longitude?: number;
  locationSource?: LocationSource;
}

export class LocationsService {
  static async getUserPrimaryLocation(userId: string) {
    const location = await prisma.userLocation.findFirst({
      where: { userId, isPrimary: true },
      select: {
        id: true,
        userId: true,
        countryCode: true,
        stateCode: true,
        stateName: true,
        cityId: true,
        cityName: true,
        locationSource: true,
        isPrimary: true,
        createdAt: true,
        updatedAt: true,
        // Exclude latitude & longitude for privacy
      },
    });

    return location;
  }

  static async setUserPrimaryLocation(userId: string, input: SetLocationInput) {
    // Check if the service area is enabled
    const serviceArea = await prisma.serviceArea.findFirst({
      where: {
        countryCode: input.countryCode,
        stateCode: input.stateCode,
        cityName: input.cityName,
        isActive: true,
      },
    });

    // Unset current primary locations
    await prisma.userLocation.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });

    // Create new primary location
    const location = await prisma.userLocation.create({
      data: {
        userId,
        countryCode: input.countryCode,
        stateCode: input.stateCode,
        stateName: input.stateName,
        cityId: input.cityId || serviceArea?.id || null,
        cityName: input.cityName,
        latitude: input.latitude || null,
        longitude: input.longitude || null,
        locationSource: input.locationSource || LocationSource.USER_SELECTED,
        isPrimary: true,
      },
      select: {
        id: true,
        userId: true,
        countryCode: true,
        stateCode: true,
        stateName: true,
        cityId: true,
        cityName: true,
        locationSource: true,
        isPrimary: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      location,
      availability: {
        isActive: serviceArea ? serviceArea.isActive : false,
        buyingEnabled: serviceArea ? serviceArea.buyingEnabled : false,
        sellingEnabled: serviceArea ? serviceArea.sellingEnabled : false,
      },
    };
  }

  static async checkMarketplaceAvailability(countryCode: string, stateCode: string, cityName: string) {
    const serviceArea = await prisma.serviceArea.findFirst({
      where: {
        countryCode,
        stateCode,
        cityName,
      },
    });

    if (!serviceArea) {
      return {
        isServed: false,
        buyingEnabled: false,
        sellingEnabled: false,
        message: 'This area is currently outside our service coverage.',
      };
    }

    return {
      isServed: serviceArea.isActive,
      buyingEnabled: serviceArea.isActive && serviceArea.buyingEnabled,
      sellingEnabled: serviceArea.isActive && serviceArea.sellingEnabled,
      serviceArea: {
        id: serviceArea.id,
        cityName: serviceArea.cityName,
        stateName: serviceArea.stateName,
      },
    };
  }
}

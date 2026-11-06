import { prisma } from './common/prisma.js';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Starting database seed...');

  // 1. Seed Service Areas
  await prisma.serviceArea.upsert({
    where: { countryCode_stateCode_cityCode: { countryCode: 'US', stateCode: 'NY', cityCode: 'NYC' } },
    update: {},
    create: {
      countryCode: 'US',
      stateCode: 'NY',
      stateName: 'New York',
      cityCode: 'NYC',
      cityName: 'New York City',
      isActive: true,
      buyingEnabled: true,
      sellingEnabled: true,
    },
  });

  await prisma.serviceArea.upsert({
    where: { countryCode_stateCode_cityCode: { countryCode: 'US', stateCode: 'CA', cityCode: 'LA' } },
    update: {},
    create: {
      countryCode: 'US',
      stateCode: 'CA',
      stateName: 'California',
      cityCode: 'LA',
      cityName: 'Los Angeles',
      isActive: true,
      buyingEnabled: true,
      sellingEnabled: true,
    },
  });

  // 2. Seed Categories & Subcategories
  let electronics = await prisma.category.findUnique({ where: { slug: 'electronics' } });
  if (!electronics) {
    electronics = await prisma.category.create({
      data: { name: 'Electronics', slug: 'electronics', sortOrder: 1 },
    });
  }

  let smartphones = await prisma.category.findUnique({ where: { slug: 'smartphones' } });
  if (!smartphones) {
    smartphones = await prisma.category.create({
      data: { name: 'Smartphones & Mobile', slug: 'smartphones', parentId: electronics.id, sortOrder: 1 },
    });
  }

  let laptops = await prisma.category.findUnique({ where: { slug: 'laptops' } });
  if (!laptops) {
    laptops = await prisma.category.create({
      data: { name: 'Laptops & Computers', slug: 'laptops', parentId: electronics.id, sortOrder: 2 },
    });
  }

  let vehicles = await prisma.category.findUnique({ where: { slug: 'vehicles' } });
  if (!vehicles) {
    vehicles = await prisma.category.create({
      data: { name: 'Vehicles & Automotive', slug: 'vehicles', sortOrder: 2 },
    });
  }

  let cars = await prisma.category.findUnique({ where: { slug: 'cars' } });
  if (!cars) {
    cars = await prisma.category.create({
      data: { name: 'Cars & Trucks', slug: 'cars', parentId: vehicles.id, sortOrder: 1 },
    });
  }

  let fashion = await prisma.category.findUnique({ where: { slug: 'fashion' } });
  if (!fashion) {
    fashion = await prisma.category.create({
      data: { name: 'Fashion & Apparel', slug: 'fashion', sortOrder: 3 },
    });
  }

  // 3. Seed Attribute Definitions
  let storageAttr = await prisma.attributeDefinition.findFirst({
    where: { categoryId: smartphones.id, slug: 'storage' },
  });
  if (!storageAttr) {
    storageAttr = await prisma.attributeDefinition.create({
      data: {
        categoryId: smartphones.id,
        name: 'Storage Capacity',
        slug: 'storage',
        dataType: 'SELECT',
        isRequired: true,
        isFilterable: true,
      },
    });

    await prisma.attributeOption.createMany({
      data: [
        { attributeDefinitionId: storageAttr.id, label: '128 GB', value: '128GB', sortOrder: 1 },
        { attributeDefinitionId: storageAttr.id, label: '256 GB', value: '256GB', sortOrder: 2 },
        { attributeDefinitionId: storageAttr.id, label: '512 GB', value: '512GB', sortOrder: 3 },
      ],
    });
  }

  // 4. Seed Demo Users
  const passwordHash = await bcrypt.hash('password123', 10);
  const alexUser = await prisma.user.upsert({
    where: { email: 'alex@example.com' },
    update: {},
    create: {
      displayName: 'Alex Morgan',
      email: 'alex@example.com',
      passwordHash,
      status: 'ACTIVE',
      role: 'USER',
    },
  });

  const sarahUser = await prisma.user.upsert({
    where: { email: 'sarah@example.com' },
    update: {},
    create: {
      displayName: 'Sarah Jenkins',
      email: 'sarah@example.com',
      passwordHash,
      status: 'ACTIVE',
      role: 'USER',
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@becho.com' },
    update: {},
    create: {
      displayName: 'System Admin',
      email: 'admin@becho.com',
      passwordHash,
      status: 'ACTIVE',
      role: 'ADMIN',
    },
  });

  // 5. Seed Sample Live Listings
  const sampleListings = [
    {
      title: 'iPhone 15 Pro Max 256GB Natural Titanium',
      description: 'Brand new condition, unlocked, includes original box, braided USB-C cable, and AppleCare coverage until late 2026. Battery health 100%.',
      price: 980,
      condition: 'LIKE_NEW',
      categoryId: smartphones.id,
      subcategoryId: smartphones.id,
      sellerId: alexUser.id,
      cityCode: 'NYC',
      stateCode: 'NY',
      status: 'LIVE',
      mediaUrl: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800',
    },
    {
      title: 'MacBook Pro 16" M3 Max 36GB RAM 1TB SSD',
      description: 'Space Black MacBook Pro 16-inch. Pristine condition with low cycle count. Perfect for video editing, software engineering, and heavy workloads.',
      price: 2450,
      condition: 'LIKE_NEW',
      categoryId: laptops.id,
      subcategoryId: laptops.id,
      sellerId: sarahUser.id,
      cityCode: 'NYC',
      stateCode: 'NY',
      status: 'LIVE',
      mediaUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800',
    },
    {
      title: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones',
      description: 'Industry-leading noise cancellation with auto NC optimizer. Crystal clear hands-free calling and 30-hour battery life. Comes with hard carry case.',
      price: 280,
      condition: 'USED',
      categoryId: electronics.id,
      sellerId: alexUser.id,
      cityCode: 'LA',
      stateCode: 'CA',
      status: 'LIVE',
      mediaUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
    },
    {
      title: 'Tesla Model 3 Long Range AWD (2023)',
      description: 'Pearl White Multi-Coat with Black Interior. 18" Aero Wheels, Full Self-Driving Capability included. Clean title, single owner, 14,000 miles.',
      price: 34500,
      condition: 'USED',
      categoryId: cars.id,
      subcategoryId: cars.id,
      sellerId: sarahUser.id,
      cityCode: 'LA',
      stateCode: 'CA',
      status: 'LIVE',
      mediaUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800',
    },
  ];

  for (const item of sampleListings) {
    const existing = await prisma.listing.findFirst({ where: { title: item.title } });
    if (!existing) {
      const listing = await prisma.listing.create({
        data: {
          title: item.title,
          description: item.description,
          price: item.price,
          condition: item.condition,
          categoryId: item.categoryId,
          subcategoryId: item.subcategoryId || null,
          sellerId: item.sellerId,
          cityCode: item.cityCode,
          stateCode: item.stateCode,
          countryCode: 'US',
          status: item.status,
          publishedAt: new Date(),
          approvedAt: new Date(),
        },
      });

      await prisma.listingMedia.create({
        data: {
          listingId: listing.id,
          mediaType: 'IMAGE',
          storageKey: `sample-${listing.id}`,
          url: item.mediaUrl,
          sortOrder: 1,
        },
      });
    }
  }

  console.log('✅ Database successfully seeded!');
}

seed().catch((err) => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});

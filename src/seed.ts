import bcrypt from 'bcryptjs';
import { prisma } from './common/prisma.js';
import { AttributeDataType, ListingStatus, UserRole, UserStatus } from './common/types/enums.js';

/**
 * Idempotent seed for local development — India launch data.
 * Demo login for every user: password "password123".
 */

const SERVICE_AREAS = [
  { stateCode: 'MH', stateName: 'Maharashtra', cityCode: 'MUM', cityName: 'Mumbai' },
  { stateCode: 'MH', stateName: 'Maharashtra', cityCode: 'PUN', cityName: 'Pune' },
  { stateCode: 'DL', stateName: 'Delhi', cityCode: 'DEL', cityName: 'New Delhi' },
  { stateCode: 'KA', stateName: 'Karnataka', cityCode: 'BLR', cityName: 'Bengaluru' },
  { stateCode: 'TG', stateName: 'Telangana', cityCode: 'HYD', cityName: 'Hyderabad' },
  { stateCode: 'TN', stateName: 'Tamil Nadu', cityCode: 'CHE', cityName: 'Chennai' },
  { stateCode: 'WB', stateName: 'West Bengal', cityCode: 'KOL', cityName: 'Kolkata' },
  { stateCode: 'GJ', stateName: 'Gujarat', cityCode: 'AMD', cityName: 'Ahmedabad' },
];

type AttrSeed = { name: string; slug: string; dataType: string; isRequired?: boolean; options?: string[] };
type CategorySeed = { name: string; slug: string; children?: (CategorySeed & { attributes?: AttrSeed[] })[] };

const CATEGORIES: CategorySeed[] = [
  {
    name: 'Mobiles',
    slug: 'mobiles',
    children: [
      {
        name: 'Mobile Phones',
        slug: 'mobile-phones',
        attributes: [
          { name: 'Brand', slug: 'brand', dataType: AttributeDataType.SELECT, isRequired: true, options: ['Apple', 'Samsung', 'Xiaomi', 'OnePlus', 'Vivo', 'Oppo', 'Realme', 'Google', 'Other'] },
          { name: 'Storage', slug: 'storage', dataType: AttributeDataType.SELECT, isRequired: true, options: ['64 GB', '128 GB', '256 GB', '512 GB', '1 TB'] },
        ],
      },
      { name: 'Tablets', slug: 'tablets' },
      { name: 'Mobile Accessories', slug: 'mobile-accessories' },
    ],
  },
  {
    name: 'Electronics & Appliances',
    slug: 'electronics',
    children: [
      { name: 'Laptops & Computers', slug: 'laptops' },
      { name: 'TVs, Video & Audio', slug: 'tv-audio' },
      { name: 'Kitchen & Home Appliances', slug: 'home-appliances' },
      { name: 'Cameras & Lenses', slug: 'cameras' },
    ],
  },
  {
    name: 'Vehicles',
    slug: 'vehicles',
    children: [
      {
        name: 'Cars',
        slug: 'cars',
        attributes: [
          { name: 'Brand', slug: 'brand', dataType: AttributeDataType.SELECT, isRequired: true, options: ['Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Honda', 'Toyota', 'Kia', 'Other'] },
          { name: 'Year', slug: 'year', dataType: AttributeDataType.NUMBER, isRequired: true },
          { name: 'Fuel', slug: 'fuel', dataType: AttributeDataType.SELECT, isRequired: true, options: ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'] },
          { name: 'KM Driven', slug: 'km-driven', dataType: AttributeDataType.NUMBER },
        ],
      },
      {
        name: 'Motorcycles & Scooters',
        slug: 'bikes',
        attributes: [
          { name: 'Brand', slug: 'brand', dataType: AttributeDataType.SELECT, isRequired: true, options: ['Hero', 'Honda', 'Bajaj', 'TVS', 'Royal Enfield', 'Yamaha', 'Ola Electric', 'Ather', 'Other'] },
          { name: 'Year', slug: 'year', dataType: AttributeDataType.NUMBER, isRequired: true },
        ],
      },
      { name: 'Bicycles', slug: 'bicycles' },
    ],
  },
  {
    name: 'Furniture',
    slug: 'furniture',
    children: [
      { name: 'Sofas & Seating', slug: 'sofas' },
      { name: 'Beds & Wardrobes', slug: 'beds-wardrobes' },
      { name: 'Tables & Desks', slug: 'tables-desks' },
    ],
  },
  {
    name: 'Fashion',
    slug: 'fashion',
    children: [
      { name: "Men's Clothing", slug: 'mens-clothing' },
      { name: "Women's Clothing", slug: 'womens-clothing' },
      { name: 'Footwear', slug: 'footwear' },
    ],
  },
];

async function upsertCategory(name: string, slug: string, sortOrder: number, parentId: string | null) {
  return prisma.category.upsert({
    where: { slug },
    update: { name, sortOrder, parentId },
    create: { name, slug, sortOrder, parentId },
  });
}

async function seedCategories() {
  for (const [i, top] of CATEGORIES.entries()) {
    const parent = await upsertCategory(top.name, top.slug, i + 1, null);
    for (const [j, child] of (top.children ?? []).entries()) {
      const category = await upsertCategory(child.name, child.slug, j + 1, parent.id);
      for (const [k, attr] of (child.attributes ?? []).entries()) {
        const existing = await prisma.attributeDefinition.findUnique({
          where: { categoryId_slug: { categoryId: category.id, slug: attr.slug } },
        });
        if (existing) continue;
        await prisma.attributeDefinition.create({
          data: {
            categoryId: category.id,
            name: attr.name,
            slug: attr.slug,
            dataType: attr.dataType,
            isRequired: attr.isRequired ?? false,
            sortOrder: k + 1,
            options: attr.options
              ? { create: attr.options.map((label, n) => ({ label, value: label.toLowerCase().replace(/\s+/g, '-'), sortOrder: n + 1 })) }
              : undefined,
          },
        });
      }
    }
  }
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash('password123', 10);
  const users = [
    { displayName: 'Aarav Sharma', email: 'aarav@example.com', phone: '+919876543210', role: UserRole.USER },
    { displayName: 'Priya Iyer', email: 'priya@example.com', phone: '+919812345678', role: UserRole.USER },
    { displayName: 'Becho Admin', email: 'admin@becho.in', phone: null, role: UserRole.ADMIN },
  ];
  const result: Record<string, string> = {};
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash, status: UserStatus.ACTIVE, phoneVerifiedAt: u.phone ? new Date() : null, emailVerifiedAt: new Date() },
    });
    result[u.email] = user.id;
  }
  return result;
}

async function seedListings(userIds: Record<string, string>) {
  const cat = async (slug: string) => (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;
  const attr = async (categorySlug: string, slug: string) =>
    (await prisma.attributeDefinition.findUniqueOrThrow({ where: { categoryId_slug: { categoryId: await cat(categorySlug), slug } } })).id;

  const day = 24 * 60 * 60 * 1000;
  const listings = [
    {
      title: 'iPhone 14 128GB Midnight, 1 year old',
      description: 'Single owner, bill and box available. Battery health 89%. No scratches, always used with a cover and screen guard.',
      price: 42000, condition: 'LIKE_NEW', category: 'mobile-phones', seller: 'aarav@example.com', stateCode: 'MH', cityCode: 'MUM',
      image: 'https://images.unsplash.com/photo-1678652197831-2d180705cd2c?w=800',
      attributes: [{ slug: 'brand', valueText: 'apple' }, { slug: 'storage', valueText: '128-gb' }],
    },
    {
      title: 'Samsung Galaxy S23 256GB Phantom Black',
      description: 'Excellent condition, under brand warranty till next year. Comes with original charger and two back covers.',
      price: 48500, condition: 'USED', category: 'mobile-phones', seller: 'priya@example.com', stateCode: 'KA', cityCode: 'BLR',
      image: 'https://images.unsplash.com/photo-1678911820864-e2c567c655d7?w=800',
      attributes: [{ slug: 'brand', valueText: 'samsung' }, { slug: 'storage', valueText: '256-gb' }],
    },
    {
      title: 'Lenovo ThinkPad E14, i5 12th Gen, 16GB RAM, 512GB SSD',
      description: 'Used for office work only. Very good keyboard and battery backup of about 5 hours. Charger included.',
      price: 38000, condition: 'USED', category: 'laptops', seller: 'priya@example.com', stateCode: 'KA', cityCode: 'BLR',
      image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800',
      attributes: [],
    },
    {
      title: 'Maruti Suzuki Swift VXi 2019, Petrol, 38,000 km',
      description: 'First owner, all services at authorised service centre. Insurance valid till March. New tyres fitted last year.',
      price: 525000, condition: 'USED', category: 'cars', seller: 'aarav@example.com', stateCode: 'MH', cityCode: 'PUN',
      image: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800',
      attributes: [{ slug: 'brand', valueText: 'maruti-suzuki' }, { slug: 'year', valueNumber: 2019 }, { slug: 'fuel', valueText: 'petrol' }, { slug: 'km-driven', valueNumber: 38000 }],
    },
    {
      title: 'Royal Enfield Classic 350, 2021, Gunmetal Grey',
      description: 'Well maintained, 14,000 km driven. All papers clear, single owner. Crash guard and touring seat installed.',
      price: 155000, condition: 'USED', category: 'bikes', seller: 'priya@example.com', stateCode: 'DL', cityCode: 'DEL',
      image: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800',
      attributes: [{ slug: 'brand', valueText: 'royal-enfield' }, { slug: 'year', valueNumber: 2021 }],
    },
    {
      title: '3-seater fabric sofa, grey, 2 years old',
      description: 'Comfortable sofa in good condition, no stains or tears. Moving out of city so selling. Buyer to arrange pickup.',
      price: 12000, condition: 'USED', category: 'sofas', seller: 'aarav@example.com', stateCode: 'MH', cityCode: 'MUM',
      image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800',
      attributes: [],
    },
  ];

  for (const item of listings) {
    if (await prisma.listing.findFirst({ where: { title: item.title } })) continue;
    const now = Date.now();
    const categoryId = await cat(item.category);
    const attributeRows = [];
    for (const a of item.attributes) {
      attributeRows.push({ attributeDefinitionId: await attr(item.category, a.slug), valueText: a.valueText ?? null, valueNumber: a.valueNumber ?? null });
    }
    await prisma.listing.create({
      data: {
        sellerId: userIds[item.seller],
        categoryId,
        title: item.title,
        description: item.description,
        price: item.price,
        currency: 'INR',
        condition: item.condition,
        countryCode: 'IN',
        stateCode: item.stateCode,
        cityCode: item.cityCode,
        status: ListingStatus.LIVE,
        submittedAt: new Date(now),
        approvedAt: new Date(now),
        publishedAt: new Date(now),
        expiresAt: new Date(now + 30 * day),
        media: { create: [{ url: item.image, storageKey: item.image, sortOrder: 1 }] },
        attributes: { create: attributeRows },
      },
    });
  }
}

async function seed() {
  console.log('🌱 Seeding database (India)...');
  for (const area of SERVICE_AREAS) {
    await prisma.serviceArea.upsert({
      where: { countryCode_stateCode_cityCode: { countryCode: 'IN', stateCode: area.stateCode, cityCode: area.cityCode } },
      update: {},
      create: { countryCode: 'IN', ...area, isActive: true, buyingEnabled: true, sellingEnabled: true },
    });
  }
  await seedCategories();
  const userIds = await seedUsers();
  await seedListings(userIds);
  console.log('✅ Seed complete. Demo logins (password "password123"): aarav@example.com, priya@example.com, admin@becho.in');
}

seed()
  .catch((err) => {
    console.error('❌ Seed error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

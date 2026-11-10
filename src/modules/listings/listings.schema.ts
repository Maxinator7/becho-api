import { z } from 'zod';
import { id } from '../../common/validation.js';
import { DEFAULT_COUNTRY_CODE, ListingCondition } from '../../common/types/enums.js';

const attributeValue = z.object({
  attributeDefinitionId: id,
  valueText: z.string().trim().max(500).optional(),
  valueNumber: z.number().finite().optional(),
  valueBoolean: z.boolean().optional(),
  // Free-form value for unstructured attributes (stored as JSONB).
  valueJson: z.unknown().optional(),
});

const mediaItem = z.object({
  url: z.string().url('Image URL must be a valid http(s) URL').regex(/^https?:\/\//, 'Image URL must be http(s)'),
  storageKey: z.string().min(1).max(300).optional(),
  mimeType: z.string().max(100).optional(),
});

const listingFields = {
  categoryId: id,
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(120),
  description: z.string().trim().min(10, 'Description must be at least 10 characters').max(5000),
  price: z.coerce.number().positive('Price must be greater than 0').max(1_000_000_000),
  condition: z.nativeEnum(ListingCondition).default(ListingCondition.USED),
  countryCode: z.string().length(2).toUpperCase().default(DEFAULT_COUNTRY_CODE),
  stateCode: z.string().trim().min(1, 'State is required').max(10).toUpperCase(),
  cityCode: z.string().trim().min(1, 'City is required').max(20).toUpperCase(),
  attributes: z.array(attributeValue).max(50).default([]),
  media: z.array(mediaItem).max(10, 'At most 10 images').default([]),
  // Arbitrary extra details for categories that don't have a fixed schema (JSONB).
  metadata: z.record(z.unknown()).optional(),
};

export const createListingSchema = z.object(listingFields);

export const updateListingSchema = z
  .object({
    ...listingFields,
    condition: listingFields.condition.removeDefault(),
    countryCode: listingFields.countryCode.removeDefault(),
    attributes: listingFields.attributes.removeDefault(),
    media: listingFields.media.removeDefault(),
  })
  .partial();

export const listingQuerySchema = z.object({
  categoryId: id.optional(),
  cityCode: z.string().toUpperCase().optional(),
  stateCode: z.string().toUpperCase().optional(),
  countryCode: z.string().toUpperCase().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  condition: z.nativeEnum(ListingCondition).optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type ListingQuery = z.infer<typeof listingQuerySchema>;

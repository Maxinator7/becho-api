export const UserRole = {
  USER: 'USER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = typeof UserRole[keyof typeof UserRole];

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BANNED: 'BANNED',
} as const;
export type UserStatus = typeof UserStatus[keyof typeof UserStatus];

export const VerificationChannel = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
} as const;
export type VerificationChannel = typeof VerificationChannel[keyof typeof VerificationChannel];

export const ListingStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  LIVE: 'LIVE',
  RESERVED: 'RESERVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  SOLD: 'SOLD',
  EXPIRED: 'EXPIRED',
  ARCHIVED: 'ARCHIVED',
  DELETED: 'DELETED',
} as const;
export type ListingStatus = typeof ListingStatus[keyof typeof ListingStatus];

export const MediaType = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  DOCUMENT: 'DOCUMENT',
} as const;
export type MediaType = typeof MediaType[keyof typeof MediaType];

export const MediaModerationStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  FLAGGED: 'FLAGGED',
  REJECTED: 'REJECTED',
} as const;
export type MediaModerationStatus = typeof MediaModerationStatus[keyof typeof MediaModerationStatus];

export const SanitizationStatus = {
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  FLAGGED: 'FLAGGED',
} as const;
export type SanitizationStatus = typeof SanitizationStatus[keyof typeof SanitizationStatus];

export const LocationSource = {
  USER_SELECTED: 'USER_SELECTED',
  GPS_VALIDATED: 'GPS_VALIDATED',
} as const;
export type LocationSource = typeof LocationSource[keyof typeof LocationSource];

export const AttributeDataType = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  SELECT: 'SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  DATE: 'DATE',
  CURRENCY: 'CURRENCY',
  MEASUREMENT: 'MEASUREMENT',
} as const;
export type AttributeDataType = typeof AttributeDataType[keyof typeof AttributeDataType];

export const OfferStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  COUNTERED: 'COUNTERED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type OfferStatus = typeof OfferStatus[keyof typeof OfferStatus];

export const NotificationType = {
  LISTING_APPROVED: 'LISTING_APPROVED',
  LISTING_REJECTED: 'LISTING_REJECTED',
  LISTING_SUSPENDED: 'LISTING_SUSPENDED',
  LISTING_EXPIRED: 'LISTING_EXPIRED',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  OFFER_CREATED: 'OFFER_CREATED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_REJECTED: 'OFFER_REJECTED',
  OFFER_COUNTERED: 'OFFER_COUNTERED',
} as const;
export type NotificationType = typeof NotificationType[keyof typeof NotificationType];

export const ReportReason = {
  FRAUD: 'FRAUD',
  SPAM: 'SPAM',
  PROHIBITED_CONTENT: 'PROHIBITED_CONTENT',
  WRONG_INFORMATION: 'WRONG_INFORMATION',
  DUPLICATE: 'DUPLICATE',
  SUSPICIOUS_SELLER: 'SUSPICIOUS_SELLER',
  OTHER: 'OTHER',
} as const;
export type ReportReason = typeof ReportReason[keyof typeof ReportReason];

export const ReportStatus = {
  PENDING: 'PENDING',
  REVIEWED: 'REVIEWED',
  DISMISSED: 'DISMISSED',
  ACTION_TAKEN: 'ACTION_TAKEN',
} as const;
export type ReportStatus = typeof ReportStatus[keyof typeof ReportStatus];


/** Phase 0 market: India. */
export const DEFAULT_CURRENCY = 'INR';
export const DEFAULT_COUNTRY_CODE = 'IN';

export const ListingCondition = {
  NEW: 'NEW',
  LIKE_NEW: 'LIKE_NEW',
  USED: 'USED',
  REFURBISHED: 'REFURBISHED',
  FOR_PARTS: 'FOR_PARTS',
} as const;
export type ListingCondition = typeof ListingCondition[keyof typeof ListingCondition];

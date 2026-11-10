import { SanitizationStatus } from '../../common/types/enums.js';

export const PROHIBITED_KEYWORDS = [
  'illegal', 'weapon', 'gun', 'drugs', 'narcotics', 'counterfeit',
  'replica', 'fake', 'stolen', 'scam', 'hack', 'pirated'
];

/** Prices above this (INR) go to manual review. ₹5 crore covers cars, bikes and most high-value items. */
export const MAX_AUTO_APPROVE_PRICE = 50_000_000;

// Whole-word match (optional plural) so "gunmetal", "burgundy" or "hackathon" are not flagged.
const KEYWORD_PATTERNS = PROHIBITED_KEYWORDS.map((term) => ({ term, re: new RegExp(`\\b${term}s?\\b`, 'i') }));

export interface SanitizationCheckResult {
  status: SanitizationStatus;
  score: number;
  reasons: string[];
  checks: Record<string, any>;
}

export class SanitizationEngine {
  static analyzeListing(data: { title: string; description: string; price: number }): SanitizationCheckResult {
    const reasons: string[] = [];
    const checks: Record<string, any> = {
      keywordCheck: 'PASSED',
      priceSanityCheck: 'PASSED',
    };

    const textToScan = `${data.title} ${data.description}`.toLowerCase();

    // 1. Prohibited Keywords Check
    const foundKeywords = KEYWORD_PATTERNS.filter(({ re }) => re.test(textToScan)).map(({ term }) => term);
    if (foundKeywords.length > 0) {
      reasons.push('PROHIBITED_CONTENT');
      checks.keywordCheck = `FLAGGED (Found terms: ${foundKeywords.join(', ')})`;
    }

    // 2. Suspicious Pricing Check
    if (data.price <= 0 || data.price > MAX_AUTO_APPROVE_PRICE) {
      reasons.push('SUSPICIOUS_PRICING');
      checks.priceSanityCheck = `FLAGGED (Unusual price: ₹${data.price})`;
    }

    // 3. Spam / Short Description Check
    if (data.description.length < 5) {
      reasons.push('MISSING_REQUIRED_INFORMATION');
      checks.descriptionCheck = 'FLAGGED (Description too short)';
    }

    const isFlagged = reasons.length > 0;
    const score = isFlagged ? Math.max(0.2, 1.0 - reasons.length * 0.3) : 1.0;

    return {
      status: isFlagged ? SanitizationStatus.FLAGGED : SanitizationStatus.PASSED,
      score,
      reasons,
      checks,
    };
  }
}

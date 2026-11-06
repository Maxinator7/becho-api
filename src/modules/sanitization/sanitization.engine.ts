import { SanitizationStatus } from '../../common/types/enums.js';

export const PROHIBITED_KEYWORDS = [
  'illegal', 'weapon', 'gun', 'drugs', 'narcotics', 'counterfeit',
  'replica', 'fake', 'stolen', 'scam', 'hack', 'pirated'
];

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
    const foundKeywords = PROHIBITED_KEYWORDS.filter(term => textToScan.includes(term));
    if (foundKeywords.length > 0) {
      reasons.push('PROHIBITED_CONTENT');
      checks.keywordCheck = `FLAGGED (Found terms: ${foundKeywords.join(', ')})`;
    }

    // 2. Suspicious Pricing Check
    if (data.price <= 0 || data.price > 1000000) {
      reasons.push('SUSPICIOUS_PRICING');
      checks.priceSanityCheck = `FLAGGED (Unusual price: $${data.price})`;
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

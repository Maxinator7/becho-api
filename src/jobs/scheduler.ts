import { ListingsService } from '../modules/listings/listings.service.js';
import { OffersService } from '../modules/offers/offers.service.js';
import { MediaService } from '../modules/media/media.service.js';

/** Runs all periodic maintenance jobs once. Exported so tests/ops can trigger it directly. */
export async function runMaintenanceJobs() {
  const listings = await ListingsService.expireListings();
  const offers = await OffersService.expireOffers();
  const uploads = await MediaService.cleanupAbandonedUploads();
  return { expiredListings: listings.expiredCount, expiredOffers: offers.expiredCount, deletedUploads: uploads.deletedCount };
}

/**
 * In-process scheduler (Phase 0). Fine for a single API instance;
 * move to a proper queue/cron worker before running multiple instances.
 */
export function startScheduler(intervalMinutes: number) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runMaintenanceJobs();
      if (result.expiredListings || result.expiredOffers || result.deletedUploads) {
        console.log(`[jobs] expired ${result.expiredListings} listing(s), ${result.expiredOffers} offer(s); deleted ${result.deletedUploads} abandoned upload(s)`);
      }
    } catch (err) {
      console.error('[jobs] maintenance run failed:', err);
    } finally {
      running = false;
    }
  };

  void tick();
  const handle = setInterval(tick, intervalMinutes * 60 * 1000);
  handle.unref();
  return () => clearInterval(handle);
}

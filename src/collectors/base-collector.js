/**
 * Base collector class — defines the interface for all platform collectors
 */
import { sourceHealth, formatHealthEvent } from '../notifications/source-health.js';
import { notifyAdminHealth } from '../notifications/admin-alert.js';

class BaseCollector {
  constructor(name, logger) {
    this.name = name;
    this.logger = logger;
    this._cycleFailures = 0;
    this._cycleSkipped  = false;
    this._cycleLastError = '';
  }

  /**
   * Collect trending items from the platform
   * @returns {Promise<Array<{externalId, source, title, description, url, metrics}>>}
   */
  async collect() {
    throw new Error(`${this.name}: collect() not implemented`);
  }

  /**
   * Normalize raw platform data into unified format
   */
  normalize(rawItem) {
    throw new Error(`${this.name}: normalize() not implemented`);
  }

  /**
   * Report a sub-request that failed and was swallowed — a single query, a
   * single page, one trend out of three. `collect()` deliberately keeps going
   * after these, which is right, but it means the cycle returns successfully
   * while doing a fraction of its job. Counting them is the only way that
   * shows up anywhere. Call it wherever a catch block currently just warns.
   */
  noteFailure(error) {
    this._cycleFailures++;
    const msg = error?.message || String(error || '');
    if (msg) this._cycleLastError = msg;
  }

  /**
   * Declare that this cycle was intentionally not run (own interval, cooldown).
   * A skipped cycle is not evidence of health OR of failure, so it must not
   * count towards a silence streak — TikTok idles through half of them.
   */
  noteSkipped() {
    this._cycleSkipped = true;
  }

  /**
   * Safe wrapper around collect with error handling
   */
  async safeCollect() {
    this._cycleFailures  = 0;
    this._cycleSkipped   = false;
    this._cycleLastError = '';

    let items = [];
    let hardFailure = 0;
    try {
      this.logger.info(`[${this.name}] Starting collection...`);
      items = await this.collect();
      this.logger.info(`[${this.name}] Collected ${items.length} items`);
    } catch (error) {
      this.logger.error(`[${this.name}] Collection failed: ${error.message}`);
      this._cycleLastError = error.message;
      hardFailure = 1;
      items = [];
    }

    this._reportHealth(items.length, hardFailure);
    return items;
  }

  /** Never let health bookkeeping break a collection cycle. */
  _reportHealth(itemCount, hardFailure) {
    try {
      const event = sourceHealth.record(this.name, {
        items:     itemCount,
        failures:  this._cycleFailures + hardFailure,
        skipped:   this._cycleSkipped,
        lastError: this._cycleLastError,
      });
      if (!event) return;
      const text = formatHealthEvent(event);
      this.logger.warn(`[health] ${text.replace(/<[^>]+>/g, '')}`);
      notifyAdminHealth(text);
    } catch (e) {
      this.logger.warn(`[${this.name}] health tracking failed: ${e.message}`);
    }
  }
}

export default BaseCollector;

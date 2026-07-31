/**
 * Ключ агентского MCP.
 *
 * Живёт в таблице `settings`, а не в `.env`, чтобы оператор мог выпустить и
 * перевыпустить его прямо из админки — без правки окружения и без редеплоя.
 * Читается на каждый запрос, поэтому ротация действует немедленно.
 *
 * Отсутствие ключа безопасно по построению: `checkAuth` с пустым ключом
 * возвращает false, то есть эндпоинт отдаёт 401 всем подряд.
 */

import crypto from 'node:crypto';

/** `cak_` + 64 hex. Префикс отличает агентский ключ от сессионного токена дашборда. */
export const AGENT_KEY_PATTERN = /^cak_[a-f0-9]{64}$/;

export const AGENT_KEY_SETTING     = 'agentApiKey';
export const AGENT_ENABLED_SETTING = 'agentApiEnabled';

/** Текущий ключ или '' если не выпущен / повреждён. */
export function getAgentKey(db) {
  try {
    const v = db.getSetting(AGENT_KEY_SETTING, '') || '';
    return AGENT_KEY_PATTERN.test(v) ? v : '';
  } catch {
    return '';
  }
}

/** Выпускает новый ключ, затирая прежний. Возвращает его в открытом виде. */
export function generateAgentKey(db) {
  const key = 'cak_' + crypto.randomBytes(32).toString('hex');
  db.setSetting(AGENT_KEY_SETTING, key);
  return key;
}

/** Отзывает ключ. После этого эндпоинт отвечает 401 на всё. */
export function revokeAgentKey(db) {
  db.setSetting(AGENT_KEY_SETTING, '');
}

/** Рубильник. По умолчанию включён — гейтом служит наличие ключа. */
export function isAgentApiEnabled(db) {
  try {
    return db.getSetting(AGENT_ENABLED_SETTING, '1') === '1';
  } catch {
    return false;
  }
}

export function setAgentApiEnabled(db, enabled) {
  db.setSetting(AGENT_ENABLED_SETTING, enabled ? '1' : '0');
}

/**
 * Маскировка для мест, где ключ не должен светиться целиком — логи, тосты.
 * В самой админке ключ показывается полностью: она loopback-only и уже
 * защищена более привилегированным `X-Admin-Key`.
 */
export function maskAgentKey(key) {
  if (!key) return '';
  return key.slice(0, 8) + '…' + key.slice(-4);
}

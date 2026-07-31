/**
 * Агентский MCP-сервер. Третий HTTP-слушатель процесса, рядом с дашбордом
 * (8080) и админкой (8081). Слушает ТОЛЬКО loopback: наружу попадают либо
 * через SSH-туннель, либо через nginx-роут, когда агент переедет на другой
 * хост. См. DEPLOY.md.
 *
 * Строго read-only. Инструментов, меняющих состояние, здесь нет и быть не
 * должно — инвариант закреплён тестом в test/agent-mcp.test.mjs.
 */

import http from 'node:http';
import crypto from 'node:crypto';

import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';

import { UserRateLimiter } from '../utils/rate-limiter.js';
import { buildTools } from './tools.js';
import { buildInstructions, buildResource, RESOURCE_URIS } from './docs.js';
import { AGENT_KEY_PATTERN, getAgentKey, isAgentApiEnabled } from './key.js';

export { AGENT_KEY_PATTERN };

export const MCP_PATH = '/mcp';

/**
 * Постоянное по времени сравнение. Хэшируем обе стороны, чтобы длина строк
 * не влияла на время и не приходилось ловить исключение timingSafeEqual
 * на буферах разной длины.
 */
export function checkAuth(authHeader, configuredKey) {
  if (!configuredKey || !AGENT_KEY_PATTERN.test(configuredKey)) return false;
  const m = String(authHeader || '').match(/^Bearer\s+(\S+)$/);
  if (!m) return false;
  const presented = m[1];
  if (!AGENT_KEY_PATTERN.test(presented)) return false;
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(configuredKey).digest();
  return crypto.timingSafeEqual(a, b);
}

export default class AgentMcpServer {
  constructor(config, logger, db) {
    this.config = config.agent;
    this.logger = logger;
    this.db = db;
    this.server = null;
    // Защита от зациклившегося агента, а не от злоумышленника — от него
    // защищает loopback. 120 вызовов в минуту с запасом покрывает research.
    this.limiter = new UserRateLimiter({ windowMs: 60_000, maxRequests: 120 });
  }

  start() {
    if (!this.config.enabled) {
      this.logger.info('Agent MCP disabled (AGENT_MCP_ENABLED != true)');
      return;
    }
    // Ключ живёт в БД и выпускается из админки, поэтому его отсутствие — не
    // повод не стартовать: без ключа эндпоинт просто отвечает 401 на всё.
    if (!getAgentKey(this.db)) {
      this.logger.warn('Agent MCP: ключ не выпущен — эндпоинт отвечает 401. Выпусти его в админке, вкладка «Agent MCP».');
    }

    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch(err => {
        this.logger.error(`Agent MCP handler error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal_error' }));
        }
      });
    });

    // Дефолт — loopback, чтобы запуск без Docker был безопасен сразу.
    // В контейнере нужен 0.0.0.0: Docker пробрасывает порт на bridge-интерфейс,
    // а НЕ на loopback контейнера, поэтому привязка к 127.0.0.1 внутри делает
    // проброшенный порт недостижимым. Ограничение «только локально» там даёт
    // host-side привязка `127.0.0.1:8082:8082` — тот же приём, что у админки.
    const host = this.config.host || '127.0.0.1';
    this.server.listen(this.config.port, host, () => {
      this.logger.info(`Agent MCP (read-only) at http://${host}:${this.config.port}${MCP_PATH}`);
    });
    this.server.on('error', err => {
      this.logger.error(`Agent MCP server error: ${err.message}`);
    });
  }

  async _handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.config.port}`);
    const send = (code, body, extraHeaders = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders });
      res.end(JSON.stringify(body));
    };

    if (url.pathname !== MCP_PATH) return send(404, { error: 'not_found' });

    // Auth первым делом. Ключ читается из БД на каждый запрос, поэтому
    // выпуск и ротация из админки действуют сразу, без рестарта процесса.
    if (!checkAuth(req.headers['authorization'], getAgentKey(this.db))) {
      return send(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer realm="catalyst-agent"' });
    }

    // Рубильник без редеплоя (настройка agentApiEnabled в таблице settings).
    if (!isAgentApiEnabled(this.db)) {
      return send(503, { error: 'agent_api_disabled' });
    }

    if (!this.limiter.allow('agent')) {
      return send(429, { error: 'rate_limited', retry_after: 60 }, { 'Retry-After': '60' });
    }

    // Stateless: свежий сервер и транспорт на запрос. Состояние держать негде
    // и незачем — все инструменты читающие и идемпотентные.
    const mcp = this._buildMcpServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  }

  _buildMcpServer() {
    const mcp = new McpServer(
      { name: 'catalyst', version: '1.0.0' },
      { instructions: buildInstructions(this.db) },
    );

    for (const tool of buildTools(this.db)) {
      mcp.registerTool(
        tool.name,
        {
          description: tool.description,
          // Схемы у нас чистый JSON Schema — SDK v2 ждёт Standard Schema,
          // поэтому оборачиваем. Без fromJsonSchema объект будет принят за
          // ZodRawShape и валидация молча сломается.
          inputSchema: fromJsonSchema(tool.inputSchema),
          annotations: { readOnlyHint: true },
        },
        async (args) => {
          const result = tool.handler(args || {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        },
      );
    }

    for (const [name, uri] of Object.entries(RESOURCE_URIS)) {
      mcp.registerResource(
        name, uri,
        {
          title: `Catalyst: ${name}`,
          description: `Справка Catalyst: ${name}`,
          mimeType: 'text/markdown',
        },
        async (u) => ({ contents: [{ uri: u.href, text: buildResource(this.db, uri) }] }),
      );
    }
    return mcp;
  }

  stop(timeoutMs = 10000) {
    return new Promise(resolve => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      const t = setTimeout(() => {
        try { this.server?.closeAllConnections?.(); } catch { /* уже закрыт */ }
        resolve();
      }, timeoutMs);
      t.unref?.();
    });
  }
}

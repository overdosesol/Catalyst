/**
 * Определения MCP-инструментов.
 *
 * Описания здесь — не комментарии для людей, а единственное, по чему модель
 * решает, что вызвать и с чем. Каждый enum перечисляет значения СО СМЫСЛОМ:
 * голый список заставляет модель гадать, а гадает она уверенно.
 */

import {
  NARRATIVE_PHASES, FORECAST_PHASES, ALERT_TYPES, PIPELINE_STATUSES, SORT_MODES,
} from '../db/feed-query.js';
import {
  searchNarratives, getNarrative, getNarrativeMedia, getStats, getFilterValues,
} from './narratives.js';

const strList = (description, enumVals) => ({
  type: 'array',
  items: enumVals ? { type: 'string', enum: enumVals } : { type: 'string' },
  description,
});

export function buildTools(db) {
  return [
    {
      name: 'search_narratives',
      description:
        'Найти нарративы с фильтрами и сортировкой. Топ нарративов = вызов без фильтров ' +
        'с sort="rank". ВАЖНО: чтобы сравнивать качество, добавь pipeline_status="scored" — ' +
        'иначе в выдачу попадут неоценённые записи, у которых score=0 по определению.',
      inputSchema: {
        type: 'object',
        properties: {
          sort: {
            type: 'string', enum: SORT_MODES, default: 'rank',
            description: 'rank — сводный балл ранжирования, режим по умолчанию, он же «топ нарративов». ' +
              'time — самые свежие. meme — по мемному потенциалу. emergence — пойманные раньше всего. ' +
              'virality — легаси, по итоговому score.',
          },
          hours: {
            type: 'integer', default: 24,
            description: 'Окно в часах. Считается по последней активности, а не по дате появления.',
          },
          source: strList(
            'Ограничить источниками. Актуальный список — в list_filter_values.', undefined),
          category: {
            type: 'string',
            description: 'Точное совпадение. Актуальные значения — в list_filter_values, не выдумывай.',
          },
          narrative_phase: strList(
            'Где нарратив на своей кривой. НЕ путать с forecast_phase — это другое поле с другими значениями.',
            NARRATIVE_PHASES),
          forecast_phase: strList(
            'Фаза из отдельного прогноза Catalyst. Заполнена лишь у части нарративов. ' +
            'НЕ путать с narrative_phase.',
            FORECAST_PHASES),
          alert_type: strList(
            'event — есть конкретный триггер-событие; trend — нарратив шире одного поста; ' +
            'post — один вирусный пост. У старых записей поле пустое, и фильтр их исключит.',
            ALERT_TYPES),
          pipeline_status: {
            type: 'string', enum: PIPELINE_STATUSES,
            description: 'scored — прошёл оценку, метрикам можно верить. ' +
              'save_only — сохранён ДО оценки, score=0 по определению, это не признак качества.',
          },
          manual_only: {
            type: 'boolean',
            description: 'Только нарративы, поданные оператором вручную через админку.',
          },
          min_score: {
            type: 'integer',
            description: 'Итоговый балл не ниже указанного (0-100). Осмыслен только для scored.',
          },
          min_emergence: {
            type: 'integer',
            description: 'Балл раннего обнаружения не ниже указанного (0-100).',
          },
          q: {
            type: 'string',
            description: 'Текстовый поиск по заголовку, объяснению и категории. До 80 символов.',
          },
          limit:  { type: 'integer', default: 20, description: 'Сколько вернуть. Максимум 100.' },
          offset: { type: 'integer', default: 0,  description: 'Смещение для листания. Сколько всего — в поле total.' },
        },
      },
      handler: (args) => searchNarratives(db, args || {}),
    },

    {
      name: 'get_narrative',
      description:
        'Один нарратив целиком: оценки, метрики, объяснение модели, блок прогноза, ' +
        'счётчики отзывов. Медиа сюда НЕ входит — для него есть get_narrative_media.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Идентификатор нарратива из search_narratives.' },
        },
        required: ['id'],
      },
      handler: (args) => getNarrative(db, args?.id),
    },

    {
      name: 'get_narrative_media',
      description:
        'Визуальная часть нарратива: ссылки на картинку и видео плюс разбор от Gemini — ' +
        'подпись, текст, ВИДИМЫЙ на изображении, пересказ видео и расшифровка речи. ' +
        'Для оценки мема текст на картинке и произнесённые слова обычно важнее подписи. ' +
        'Отдельный вызов, потому что данные тяжёлые и нужны не всегда. ' +
        'Разбора может не быть (caption_available=false) — этап обогащения деградирует молча.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Идентификатор нарратива из search_narratives.' },
        },
        required: ['id'],
      },
      handler: (args) => getNarrativeMedia(db, args?.id),
    },

    {
      name: 'list_filter_values',
      description:
        'Актуальные значения всех фильтров: категории и источники берутся ИЗ БАЗЫ. ' +
        'Вызови это перед первым поиском — выдуманная категория даёт пустой ответ ' +
        'без объяснения причины.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => getFilterValues(db),
    },

    {
      name: 'get_stats',
      description:
        'Сводка по ленте за окно: сколько всего, разбивка по источникам, категориям ' +
        'и статусу обработки, средний балл. Полезно понять объём и долю оценённых ' +
        'записей до того, как строить поиск.',
      inputSchema: {
        type: 'object',
        properties: {
          hours: { type: 'integer', default: 24, description: 'Окно в часах, по последней активности.' },
        },
      },
      handler: (args) => getStats(db, args?.hours),
    },
  ];
}

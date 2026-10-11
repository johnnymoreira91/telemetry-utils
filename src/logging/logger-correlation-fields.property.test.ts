/**
 * Teste de propriedade — campos de correlação condicionados ao escopo de Namespace.
 *
 * Feature: telemetry-utils, Property 4: Campos de correlação condicionados ao escopo de Namespace
 *
 * Para qualquer registro de log, os campos `correlationId` e `keyId` estão
 * presentes se e somente se existe um escopo de Namespace ativo com esses valores
 * armazenados; na ausência de escopo ativo, o registro é emitido sem esses campos.
 *
 * Abordagem: um `LoggerService` real é construído com `LOG_FORMAT=json`, de modo
 * que o formato combinado em produção (`otelFormat` + `WinstonLogger.formatContext`
 * + `timestamp` + `json`) seja exatamente o exercitado. O `formatContext` lê a
 * instância default do Namespace (`import namespace from './namespace'`), então
 * o teste manipula essa MESMA instância default: emissões dentro de
 * `namespace.run(...)` com valores armazenados representam o caso positivo, e
 * emissões fora de escopo representam o caso negativo.
 *
 * Um transporte winston in-memory captura o registro renderizado (o JSON final em
 * `Symbol.for('message')`), e a asserção verifica a presença/ausência de
 * `correlationId`/`keyId` contra o estado de escopo do Namespace.
 *
 * Validates: Requirements 2.4, 2.5
 */

import * as fc from 'fast-check';
import * as winston from 'winston';
import Transport from 'winston-transport';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import namespace from './namespace';
import { LoggerService } from './logger-service';

const NUM_RUNS = 100;

/** Chave simbólica usada pelo winston para armazenar a linha renderizada final. */
const MESSAGE = Symbol.for('message');

/**
 * Transporte winston in-memory: captura o `info` final de cada registro emitido,
 * incluindo o JSON renderizado disponível em `info[Symbol.for('message')]`. Como
 * não define `format` próprio, herda o formato combinado do logger (idêntico ao
 * de produção), permitindo inspecionar os campos efetivamente serializados.
 */
class CaptureTransport extends Transport {
  public readonly records: winston.Logform.TransformableInfo[] = [];

  log(info: winston.Logform.TransformableInfo, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

/**
 * Constrói um `LoggerService` (LOG_FORMAT=json) e anexa um `CaptureTransport`.
 * Retorna o logger e o transporte para inspeção dos registros renderizados.
 */
function buildLogger(): { logger: LoggerService; capture: CaptureTransport } {
  const logger = new LoggerService('TestContext', 'verbose');
  const capture = new CaptureTransport();
  logger.add(capture);
  return { logger, capture };
}

/**
 * Faz o parse do JSON renderizado do último registro capturado (o conteúdo de
 * `Symbol.for('message')`, produzido por `winston.format.json()`).
 */
function parseRenderedRecord(capture: CaptureTransport): Record<string, unknown> {
  expect(capture.records.length).toBeGreaterThan(0);
  const last = capture.records[capture.records.length - 1];
  const rendered = (last as unknown as Record<symbol, unknown>)[MESSAGE];
  expect(typeof rendered).toBe('string');
  return JSON.parse(rendered as string) as Record<string, unknown>;
}

/** LOG_FORMAT fixado em json para exercitar o formato combinado estruturado. */
beforeEach(() => {
  process.env.LOG_FORMAT = 'json';
});

afterEach(() => {
  delete process.env.LOG_FORMAT;
});

/**
 * Gerador de valores de correlação não-vazios. `formatContext` injeta o campo
 * apenas quando o valor lido não é `null`/`undefined`; strings não-vazias são
 * representativas dos identificadores reais (Correlation_Id / keyId).
 */
const correlationValueArb = fc.string({ minLength: 1, maxLength: 40 });

describe('Property 4: Campos de correlação condicionados ao escopo de Namespace', () => {
  it('inclui correlationId e keyId quando emitido dentro de um escopo ativo com esses valores', () => {
    fc.assert(
      fc.property(
        correlationValueArb,
        correlationValueArb,
        fc.string({ maxLength: 30 }),
        (correlationId, keyId, message) => {
          const { logger, capture } = buildLogger();

          try {
            namespace.run(() => {
              namespace.setRequestId(correlationId);
              namespace.setkeyId(keyId);
              logger.info(message);
            });

            const record = parseRenderedRecord(capture);

            expect(record.correlationId).toBe(correlationId);
            expect(record.keyId).toBe(keyId);
          } finally {
            logger.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('omite correlationId e keyId quando emitido fora de qualquer escopo ativo', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (message) => {
        const { logger, capture } = buildLogger();

        try {
          // Emissão fora de namespace.run(...): nenhum escopo ativo (R2.5).
          logger.info(message);

          const record = parseRenderedRecord(capture);

          expect('correlationId' in record).toBe(false);
          expect('keyId' in record).toBe(false);
        } finally {
          logger.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('inclui apenas correlationId quando somente o Correlation_Id está armazenado no escopo', () => {
    fc.assert(
      fc.property(correlationValueArb, fc.string({ maxLength: 30 }), (correlationId, message) => {
        const { logger, capture } = buildLogger();

        try {
          namespace.run(() => {
            namespace.setRequestId(correlationId);
            logger.info(message);
          });

          const record = parseRenderedRecord(capture);

          expect(record.correlationId).toBe(correlationId);
          expect('keyId' in record).toBe(false);
        } finally {
          logger.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('inclui apenas keyId quando somente o keyId está armazenado no escopo', () => {
    fc.assert(
      fc.property(correlationValueArb, fc.string({ maxLength: 30 }), (keyId, message) => {
        const { logger, capture } = buildLogger();

        try {
          namespace.run(() => {
            namespace.setkeyId(keyId);
            logger.info(message);
          });

          const record = parseRenderedRecord(capture);

          expect(record.keyId).toBe(keyId);
          expect('correlationId' in record).toBe(false);
        } finally {
          logger.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('escopo vazio (run sem armazenar valores) emite sem campos de correlação', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (message) => {
        const { logger, capture } = buildLogger();

        try {
          namespace.run(() => {
            // Escopo ativo, porém sem Correlation_Id/keyId armazenados.
            logger.info(message);
          });

          const record = parseRenderedRecord(capture);

          expect('correlationId' in record).toBe(false);
          expect('keyId' in record).toBe(false);
        } finally {
          logger.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

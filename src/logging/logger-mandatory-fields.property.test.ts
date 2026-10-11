/**
 * Teste de propriedade — campos obrigatórios do registro de log.
 *
 * Feature: telemetry-utils, Property 1: Registro de log sempre contém campos obrigatórios
 *
 * Para qualquer mensagem, nível válido e serviço, o registro de log emitido pelo
 * LoggerService contém os campos `timestamp`, `level`, `service` e `message`.
 *
 * Estratégia: constrói-se um LoggerService real (com `LOG_FORMAT=json` para que
 * o formato combinado — otelFormat + formatContext + timestamp + json — produza
 * o registro renderizado) e anexa-se um transporte winston in-memory que captura
 * cada `info` emitido. O formato `winston.format.json()` renderiza o registro
 * final na propriedade `Symbol.for('message')` do `info`; esse JSON é parseado e
 * verifica-se a presença das quatro chaves obrigatórias (R1.3). O nível
 * configurado é `verbose` (menor prioridade) para que todos os níveis emitam.
 *
 * Validates: Requirements 1.3
 */

import * as fc from 'fast-check';
import * as winston from 'winston';
import Transport from 'winston-transport';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LoggerService } from './logger-service';
import { LOG_LEVELS, type LogLevel } from '../types';

const NUM_RUNS = 100;

/** Chave simbólica onde o `winston.format.json()` grava o registro renderizado. */
const MESSAGE = Symbol.for('message');

/**
 * Transporte winston in-memory: acumula cada registro emitido, preservando o
 * `info` completo (incluindo a propriedade `Symbol.for('message')` com o JSON
 * final renderizado pelo formato combinado do logger).
 */
class CapturingTransport extends Transport {
  public readonly records: winston.Logform.TransformableInfo[] = [];

  log(info: winston.Logform.TransformableInfo, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

/** Gerador de nível de log válido (R1.1). */
const logLevelArb = fc.constantFrom<LogLevel>(...LOG_LEVELS);

/** Gerador de nome de serviço não-vazio. */
const serviceArb = fc.string({ minLength: 1 });

/** Gerador de mensagem arbitrária (inclui strings vazias e com caracteres especiais). */
const messageArb = fc.string();

const originalEnv = process.env;

beforeEach(() => {
  // Isola o ambiente: JSON para renderizar o registro estruturado no console
  // e evitar o formato estilizado; sem Loki/Kubernetes para manter o teste puro.
  process.env = {
    ...originalEnv,
    LOG_FORMAT: 'json',
    LOKI_TRANSPORT: 'false',
    KUBERNETES: 'false',
  };
});

afterEach(() => {
  process.env = originalEnv;
});

/**
 * Constrói um LoggerService no nível `verbose` (emite todos os níveis), anexa um
 * transporte capturador e emite `message` no `level` informado para o serviço
 * `service`. Retorna o registro renderizado (parse do JSON em `Symbol.for('message')`).
 */
function emitAndCapture(
  level: LogLevel,
  message: string,
  service: string,
): Record<string, unknown> {
  const logger = new LoggerService('TestContext', 'verbose', 'test-stage', service);

  const transport = new CapturingTransport({ level: 'verbose' });
  logger.add(transport);

  logger.log(level, message);

  const info = transport.records[transport.records.length - 1];

  logger.remove(transport);
  logger.close();

  expect(info).toBeDefined();

  const rendered = (info as unknown as Record<symbol, unknown>)[MESSAGE];
  expect(typeof rendered).toBe('string');

  return JSON.parse(rendered as string) as Record<string, unknown>;
}

describe('Property 1: Registro de log sempre contém campos obrigatórios', () => {
  it('o registro emitido sempre contém timestamp, level, service e message', () => {
    fc.assert(
      fc.property(logLevelArb, messageArb, serviceArb, (level, message, service) => {
        const record = emitAndCapture(level, message, service);

        // Campos obrigatórios presentes (R1.3).
        expect(record).toHaveProperty('timestamp');
        expect(record).toHaveProperty('level');
        expect(record).toHaveProperty('service');
        expect(record).toHaveProperty('message');

        // Consistência dos valores emitidos.
        expect(record.level).toBe(level);
        expect(record.service).toBe(service);
        expect(record.message).toBe(message);
        expect(typeof record.timestamp).toBe('string');
        expect((record.timestamp as string).length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('mantém os campos obrigatórios mesmo com mensagem vazia', () => {
    const record = emitAndCapture('info', '', 'edge-service');

    expect(record).toHaveProperty('timestamp');
    expect(record).toHaveProperty('level');
    expect(record).toHaveProperty('service');
    expect(record).toHaveProperty('message');
    expect(record.level).toBe('info');
    expect(record.service).toBe('edge-service');
    expect(record.message).toBe('');
  });
});

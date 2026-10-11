/**
 * Teste de propriedade — filtragem por prioridade de nível.
 *
 * Feature: telemetry-utils, Property 2: Filtragem por prioridade de nível
 *
 * Para qualquer `LOG_LEVEL` configurado e qualquer nível de registro, o registro
 * é emitido se e somente se a prioridade numérica do nível do registro for menor
 * ou igual à prioridade numérica do `LOG_LEVEL` configurado (`crit`=0 …
 * `verbose`=7).
 *
 * A fonte de verdade das prioridades é `WinstonLogger.levels`, exatamente a mesma
 * tabela usada em produção para configurar o logger. Um transporte in-memory
 * captura as emissões reais do winston, de modo que a asserção compara a emissão
 * efetiva contra a comparação de prioridades.
 *
 * Validates: Requirements 1.1, 1.6, 1.7
 */

import * as fc from 'fast-check';
import * as winston from 'winston';
import Transport from 'winston-transport';
import { afterEach, describe, expect, it } from 'vitest';

import { WinstonLogger } from './winston-logger';
import { LOG_LEVELS, type LogLevel } from '../types';

const NUM_RUNS = 100;

/**
 * Prioridades numéricas por nível, lidas diretamente de `WinstonLogger.levels`
 * (fonte de verdade — R1.1). `crit`=0 (maior prioridade) … `verbose`=7 (menor).
 */
const LEVEL_PRIORITIES = WinstonLogger.levels as Record<LogLevel, number>;

/** Gerador de nível de log válido (configurado e/ou do registro). */
const logLevelArb = fc.constantFrom<LogLevel>(...LOG_LEVELS);

/**
 * Transporte winston in-memory: acumula cada registro realmente emitido pelo
 * logger (ou seja, os que passaram pelo filtro de nível). Serve de espião para
 * verificar emissão vs. supressão sem depender de I/O real.
 */
class MemoryTransport extends Transport {
  public readonly records: winston.Logform.TransformableInfo[] = [];

  log(info: winston.Logform.TransformableInfo, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

let logger: WinstonLogger | undefined;

afterEach(() => {
  logger?.close();
  logger = undefined;
});

/**
 * Constrói um WinstonLogger configurado no `configuredLevel`, com os níveis
 * customizados da biblioteca e um transporte in-memory, e emite uma mensagem no
 * `recordLevel`. Retorna se houve emissão (registro capturado pelo transporte).
 */
function emits(configuredLevel: LogLevel, recordLevel: LogLevel): boolean {
  const transport = new MemoryTransport({ level: configuredLevel });

  logger = new WinstonLogger({
    levels: WinstonLogger.levels,
    level: configuredLevel,
    transports: [transport],
  });

  logger.log(recordLevel, 'mensagem de teste');

  const emitted = transport.records.length > 0;

  logger.close();
  logger = undefined;

  return emitted;
}

describe('Property 2: Filtragem por prioridade de nível', () => {
  it('emite um registro se e somente se prioridade(registro) <= prioridade(configurado)', () => {
    fc.assert(
      fc.property(logLevelArb, logLevelArb, (configuredLevel, recordLevel) => {
        const shouldEmit = LEVEL_PRIORITIES[recordLevel] <= LEVEL_PRIORITIES[configuredLevel];

        expect(emits(configuredLevel, recordLevel)).toBe(shouldEmit);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('sempre emite quando o nível do registro é igual ao configurado', () => {
    fc.assert(
      fc.property(logLevelArb, (level) => {
        expect(emits(level, level)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('nunca emite registros de prioridade estritamente inferior à configurada', () => {
    fc.assert(
      fc.property(logLevelArb, logLevelArb, (configuredLevel, recordLevel) => {
        fc.pre(LEVEL_PRIORITIES[recordLevel] > LEVEL_PRIORITIES[configuredLevel]);

        expect(emits(configuredLevel, recordLevel)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a tabela de prioridades reflete crit=0 … verbose=7 (fonte de verdade)', () => {
    expect(LEVEL_PRIORITIES.crit).toBe(0);
    expect(LEVEL_PRIORITIES.verbose).toBe(7);
    // Monotonicidade crescente conforme a ordem canônica dos níveis.
    for (let i = 1; i < LOG_LEVELS.length; i += 1) {
      expect(LEVEL_PRIORITIES[LOG_LEVELS[i]]).toBeGreaterThan(
        LEVEL_PRIORITIES[LOG_LEVELS[i - 1]],
      );
    }
  });
});

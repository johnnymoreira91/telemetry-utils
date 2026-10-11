/**
 * Testes de propriedade do Config Loader — resolvers de configuração enumerada.
 *
 * Feature: telemetry-utils, Property 5: Resolução de configuração enumerada com fallback
 * Validates: Requirements 1.8, 1.9, 9.3
 */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';

import {
  OTEL_LOG_LEVELS,
  resolveLogFormat,
  resolveLogLevel,
  resolveOtelLogLevel,
} from './env';
import {
  LOG_FORMATS,
  LOG_LEVELS,
  type LogFormat,
  type LogLevel,
} from '../types';

const MIN_RUNS = 100;

const DEFAULT_LOG_LEVEL: LogLevel = 'info';
const DEFAULT_LOG_FORMAT: LogFormat = 'text';
const DEFAULT_OTEL_LOG_LEVEL = 'WARN';

/**
 * Feature: telemetry-utils, Property 5: Resolução de configuração enumerada com fallback
 *
 * Para qualquer valor de entrada de `LOG_LEVEL`, `LOG_FORMAT` ou
 * `OTEL_LOG_LEVEL`, a resolução retorna o próprio valor quando ele pertence ao
 * conjunto permitido e retorna o valor padrão correspondente (`info`, `text`,
 * `WARN`) quando a entrada é inválida ou ausente.
 */
describe('Property 5: Resolução de configuração enumerada com fallback', () => {
  // -------------------------------------------------------------------------
  // LOG_LEVEL (R1.8)
  // -------------------------------------------------------------------------
  describe('resolveLogLevel (LOG_LEVEL)', () => {
    it('preserva qualquer valor pertencente ao conjunto permitido', () => {
      fc.assert(
        fc.property(fc.constantFrom(...LOG_LEVELS), (level) => {
          expect(resolveLogLevel(level)).toBe(level);
        }),
        { numRuns: MIN_RUNS },
      );
    });

    it('retorna o default `info` para qualquer entrada inválida ou ausente', () => {
      // Silencia o console.error de diagnóstico emitido no fallback (R1.8).
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        fc.assert(
          fc.property(
            fc.oneof(
              fc.constant(undefined),
              fc
                .string()
                .filter((s) => !(LOG_LEVELS as readonly string[]).includes(s)),
            ),
            (raw) => {
              expect(resolveLogLevel(raw)).toBe(DEFAULT_LOG_LEVEL);
            },
          ),
          { numRuns: MIN_RUNS },
        );
      } finally {
        errSpy.mockRestore();
      }
    });

    it('sempre retorna um valor pertencente ao conjunto permitido', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        fc.assert(
          fc.property(
            fc.oneof(fc.constant(undefined), fc.string(), fc.constantFrom(...LOG_LEVELS)),
            (raw) => {
              expect(LOG_LEVELS).toContain(resolveLogLevel(raw));
            },
          ),
          { numRuns: MIN_RUNS },
        );
      } finally {
        errSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // LOG_FORMAT (R1.9)
  // -------------------------------------------------------------------------
  describe('resolveLogFormat (LOG_FORMAT)', () => {
    it('preserva qualquer valor pertencente ao conjunto permitido', () => {
      fc.assert(
        fc.property(fc.constantFrom(...LOG_FORMATS), (format) => {
          expect(resolveLogFormat(format)).toBe(format);
        }),
        { numRuns: MIN_RUNS },
      );
    });

    it('retorna o default `text` para qualquer entrada inválida ou ausente', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(undefined),
            fc
              .string()
              .filter((s) => !(LOG_FORMATS as readonly string[]).includes(s)),
          ),
          (raw) => {
            expect(resolveLogFormat(raw)).toBe(DEFAULT_LOG_FORMAT);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('sempre retorna um valor pertencente ao conjunto permitido', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant(undefined), fc.string(), fc.constantFrom(...LOG_FORMATS)),
          (raw) => {
            expect(LOG_FORMATS).toContain(resolveLogFormat(raw));
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });

  // -------------------------------------------------------------------------
  // OTEL_LOG_LEVEL (R9.3)
  // -------------------------------------------------------------------------
  describe('resolveOtelLogLevel (OTEL_LOG_LEVEL)', () => {
    it('preserva (normalizado em caixa alta) qualquer valor permitido, de forma case-insensitive com espacos ao redor', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...OTEL_LOG_LEVELS),
          // Permutacoes de caixa e espacos em branco ao redor nao devem alterar a resolucao.
          fc.boolean(),
          fc.stringMatching(/^[ \t]*$/),
          fc.stringMatching(/^[ \t]*$/),
          (level, upper, pre, post) => {
            const raw = `${pre}${upper ? level.toUpperCase() : level.toLowerCase()}${post}`;
            expect(resolveOtelLogLevel(raw)).toBe(level.toUpperCase());
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('retorna o default `WARN` para qualquer entrada inválida ou ausente', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(undefined),
            fc
              .string()
              .filter((s) => !OTEL_LOG_LEVELS.includes(s.trim().toUpperCase())),
          ),
          (raw) => {
            expect(resolveOtelLogLevel(raw)).toBe(DEFAULT_OTEL_LOG_LEVEL);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('sempre retorna um nível de diagnóstico pertencente ao conjunto permitido', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant(undefined), fc.string(), fc.constantFrom(...OTEL_LOG_LEVELS)),
          (raw) => {
            expect(OTEL_LOG_LEVELS).toContain(resolveOtelLogLevel(raw));
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });
});

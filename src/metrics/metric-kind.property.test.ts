/**
 * Teste de propriedade — validação do tipo de métrica.
 *
 * Feature: telemetry-utils, Property 11: Validação do tipo de métrica
 *
 * Para qualquer identificador de tipo de métrica, o registro é aceito e produz
 * um handle quando o tipo é `counter`, `histogram` ou `gauge`, e é rejeitado
 * com erro descritivo quando o tipo não pertence a esse conjunto.
 *
 * Validates: Requirements 4.1, 4.6
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config/env';
import { METRIC_KINDS, type MetricKind } from '../types';
import { MetricsProvider } from './metrics-provider';

const NUM_RUNS = 100;

/**
 * Config mínima resolvida a partir de um ambiente vazio (aplica os defaults).
 * A API de métricas do `@opentelemetry/api` sem SDK registrado retorna
 * instrumentos no-op, suficientes para este teste: `register` ainda produz um
 * handle com `record`, sem necessidade de exportadores reais.
 */
const config = loadConfig({});

/** Gerador de tipos de métrica válidos (R4.1). */
const validKindArb: fc.Arbitrary<MetricKind> = fc.constantFrom(...METRIC_KINDS);

/**
 * Gerador de identificadores de tipo inválidos: qualquer string que não
 * pertença ao conjunto permitido (R4.6).
 */
const invalidKindArb: fc.Arbitrary<string> = fc
  .string()
  .filter((s) => !(METRIC_KINDS as readonly string[]).includes(s));

describe('Property 11: Validação do tipo de métrica', () => {
  it('aceita tipos válidos e produz um handle com record', () => {
    fc.assert(
      fc.property(validKindArb, fc.string({ minLength: 1 }), (kind, name) => {
        const provider = new MetricsProvider(config);
        const handle = provider.register(kind, name);

        expect(handle).toBeDefined();
        expect(typeof handle.record).toBe('function');
        // O handle deve registrar uma medição sem lançar (instrumento no-op).
        expect(() => handle.record(1)).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejeita tipos inválidos com erro descritivo identificando o tipo', () => {
    fc.assert(
      fc.property(invalidKindArb, fc.string({ minLength: 1 }), (kind, name) => {
        const provider = new MetricsProvider(config);

        let thrown: unknown;
        try {
          // Cast intencional: exercita o caminho de validação em runtime (R4.6).
          provider.register(kind as MetricKind, name);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        // A mensagem deve identificar o tipo inválido informado.
        expect(message).toContain(kind);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

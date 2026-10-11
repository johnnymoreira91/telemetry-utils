/**
 * Teste de propriedade — validação estrita de Export_Target.
 *
 * Feature: telemetry-utils, Property 14: Validação estrita de Export_Target
 *
 * Para qualquer valor de Export_Target por sinal, a configuração é aceita
 * quando o valor é `alloy` ou `otlp`, e é rejeitada com erro descritivo
 * (preservando o estado não inicializado) quando o valor é qualquer outro.
 *
 * Validates: Requirements 6.1, 6.4, 7.7
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { resolveExportTarget } from './env';
import { EXPORT_TARGETS, type ExportTarget } from '../types';

const NUM_RUNS = 100;

/** Sinais de telemetria exportáveis aos quais o Export_Target se aplica. */
const SIGNALS: readonly ('metrics' | 'traces')[] = ['metrics', 'traces'] as const;

/** Gerador de sinal de telemetria. */
const signalArb = fc.constantFrom(...SIGNALS);

/** Gerador de valor de Export_Target válido (`alloy` | `otlp`). */
const validTargetArb = fc.constantFrom<ExportTarget>(...EXPORT_TARGETS);

/**
 * Gerador de valor inválido: qualquer string que NÃO pertença ao conjunto
 * permitido, mais o caso ausente (`undefined`).
 */
const invalidRawArb = fc.oneof(
  fc
    .string()
    .filter((s) => !(EXPORT_TARGETS as readonly string[]).includes(s)),
  fc.constant(undefined),
);

describe('Property 14: Validação estrita de Export_Target', () => {
  it('aceita valor válido (alloy|otlp) e o retorna inalterado para qualquer sinal', () => {
    fc.assert(
      fc.property(validTargetArb, signalArb, (value, signal) => {
        const resolved = resolveExportTarget(value, signal);
        expect(resolved).toBe(value);
        expect(EXPORT_TARGETS).toContain(resolved);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejeita valor inválido/ausente com erro descritivo, sem retornar config (estado não inicializado)', () => {
    fc.assert(
      fc.property(invalidRawArb, signalArb, (raw, signal) => {
        let threw = false;
        let caught: unknown;
        let returned: ExportTarget | undefined;

        try {
          // Captura o retorno para garantir que NENHUMA config é produzida
          // em caso inválido (estado não inicializado preservado — R7.7).
          returned = resolveExportTarget(raw, signal);
        } catch (error) {
          threw = true;
          caught = error;
        }

        // Deve rejeitar: nunca retorna um valor para entrada inválida.
        expect(threw).toBe(true);
        expect(returned).toBeUndefined();

        // Erro descritivo identificando sinal e valor inválido (R6.4).
        expect(caught).toBeInstanceOf(Error);
        const message = (caught as Error).message;
        expect(message).toContain(signal);
        if (raw === undefined) {
          expect(message).toContain('(ausente)');
        } else {
          expect(message).toContain(raw);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

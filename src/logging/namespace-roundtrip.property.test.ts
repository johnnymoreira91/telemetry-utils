/**
 * Teste de propriedade — round-trip de armazenamento do Namespace dentro de escopo.
 *
 * Feature: telemetry-utils, Property 6: Round-trip de armazenamento do Namespace dentro de escopo
 *
 * Para qualquer valor, quando armazenado via `setRequestId`/`setkeyId` dentro de
 * um escopo ativo, uma leitura subsequente via `getRequestId`/`getkeyId` no mesmo
 * escopo retorna um valor igual ao armazenado.
 *
 * Validates: Requirements 2.2, 2.3
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Namespace } from './namespace';

const NUM_RUNS = 100;

/**
 * Gerador de valores arbitrários abrangendo os tipos que um chamador pode
 * armazenar como Correlation_Id / keyId (strings, números, booleanos, objetos,
 * arrays, etc.). `null` é excluído porque `getRequestId` já usa `null` como
 * sentinela de ausência; `undefined` é excluído porque é o sentinela de "sem
 * valor armazenado" (R2.7). O round-trip de valores definidos é o alvo de R2.2/R2.3.
 */
const storedValueArb = fc.anything({
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
}).filter((v) => v !== undefined && v !== null);

describe('Property 6: Round-trip de armazenamento do Namespace dentro de escopo', () => {
  it('getRequestId dentro do escopo retorna o valor armazenado por setRequestId', () => {
    fc.assert(
      fc.property(storedValueArb, (value) => {
        // Instância fresca por execução para evitar interferência cruzada.
        const namespace = new Namespace();

        let readBack: unknown;
        let wasActive = false;

        namespace.run(() => {
          wasActive = namespace.isActived();
          namespace.setRequestId(value);
          readBack = namespace.getRequestId();
        });

        // O escopo deve estar ativo dentro de run() (R2.1).
        expect(wasActive).toBe(true);
        // Round-trip: a leitura retorna um valor igual ao armazenado (R2.2, R2.3).
        expect(readBack).toStrictEqual(value);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('getkeyId dentro do escopo retorna o valor armazenado por setkeyId', () => {
    fc.assert(
      fc.property(storedValueArb, (value) => {
        const namespace = new Namespace();

        let readBack: unknown;

        namespace.run(() => {
          namespace.setkeyId(value);
          readBack = namespace.getkeyId();
        });

        expect(readBack).toStrictEqual(value);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('correlationId e keyId coexistem no mesmo escopo sem interferência mútua', () => {
    fc.assert(
      fc.property(storedValueArb, storedValueArb, (requestId, keyId) => {
        const namespace = new Namespace();

        let readRequestId: unknown;
        let readKeyId: unknown;

        namespace.run(() => {
          namespace.setRequestId(requestId);
          namespace.setkeyId(keyId);
          readRequestId = namespace.getRequestId();
          readKeyId = namespace.getkeyId();
        });

        expect(readRequestId).toStrictEqual(requestId);
        expect(readKeyId).toStrictEqual(keyId);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a última escrita prevalece quando o mesmo campo é sobrescrito no escopo', () => {
    fc.assert(
      fc.property(storedValueArb, storedValueArb, (first, second) => {
        const namespace = new Namespace();

        let readBack: unknown;

        namespace.run(() => {
          namespace.setRequestId(first);
          namespace.setRequestId(second);
          readBack = namespace.getRequestId();
        });

        expect(readBack).toStrictEqual(second);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

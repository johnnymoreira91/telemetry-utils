/**
 * Teste de propriedade — operações do Namespace fora de escopo.
 *
 * Feature: telemetry-utils, Property 8: Operações do Namespace fora de escopo
 *
 * Para qualquer valor, invocar `setRequestId`/`setkeyId` fora de um escopo ativo
 * não armazena o valor e não interrompe a execução, e `getRequestId` fora de escopo
 * (ou em escopo sem valor armazenado) retorna um valor indefinido.
 *
 * Nota sobre os sentinelas de ausência da implementação: `getRequestId` retorna
 * `null` e `getkeyId` retorna `undefined` quando não há valor armazenado (R2.7).
 *
 * Validates: Requirements 2.6, 2.7
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Namespace } from './namespace';

const NUM_RUNS = 100;

/**
 * Gerador de valores arbitrários abrangendo os tipos que um chamador pode tentar
 * armazenar como Correlation_Id / keyId. Inclui `undefined`/`null` porque, mesmo
 * esses valores, uma escrita fora de escopo deve ser um no-op que não interrompe a
 * execução (R2.6).
 */
const anyValueArb = fc.anything({
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
});

describe('Property 8: Operações do Namespace fora de escopo', () => {
  it('setRequestId/setkeyId fora de escopo são no-op que não interrompem a execução e não armazenam valor', () => {
    fc.assert(
      fc.property(anyValueArb, anyValueArb, (requestId, keyId) => {
        // Instância fresca por execução; nenhum run() é aberto -> sem escopo ativo.
        const namespace = new Namespace();

        // Pré-condição: fora de escopo não há escopo ativo (R2.5).
        expect(namespace.isActived()).toBe(false);

        // set* fora de escopo não deve lançar (R2.6).
        expect(() => namespace.setRequestId(requestId)).not.toThrow();
        expect(() => namespace.setkeyId(keyId)).not.toThrow();

        // Ainda sem escopo ativo após as escritas no-op.
        expect(namespace.isActived()).toBe(false);

        // get* fora de escopo retorna o sentinela de ausência: nada foi armazenado (R2.7).
        expect(namespace.getRequestId()).toBeNull();
        expect(namespace.getkeyId()).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('getRequestId/getkeyId dentro de um escopo sem valor armazenado retornam o sentinela de ausência', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const namespace = new Namespace();

        let readRequestId: unknown = 'unset';
        let readKeyId: unknown = 'unset';
        let wasActive = false;

        // Abre um escopo mas NÃO armazena nada (R2.7: escopo ativo sem valor).
        namespace.run(() => {
          wasActive = namespace.isActived();
          readRequestId = namespace.getRequestId();
          readKeyId = namespace.getkeyId();
        });

        // O escopo esteve ativo durante run().
        expect(wasActive).toBe(true);
        // Sem valor armazenado, as leituras retornam o sentinela de ausência (R2.7).
        expect(readRequestId).toBeNull();
        expect(readKeyId).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('uma escrita fora de escopo não vaza para um escopo subsequente', () => {
    fc.assert(
      fc.property(anyValueArb, anyValueArb, (requestId, keyId) => {
        const namespace = new Namespace();

        // Escrita fora de escopo (no-op).
        namespace.setRequestId(requestId);
        namespace.setkeyId(keyId);

        let readRequestId: unknown = 'unset';
        let readKeyId: unknown = 'unset';

        // Um escopo aberto depois parte de um store vazio: nada vazou da escrita no-op.
        namespace.run(() => {
          readRequestId = namespace.getRequestId();
          readKeyId = namespace.getkeyId();
        });

        expect(readRequestId).toBeNull();
        expect(readKeyId).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

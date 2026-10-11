/**
 * Teste de propriedade — isolamento entre escopos concorrentes do Namespace.
 *
 * Feature: telemetry-utils, Property 7: Isolamento entre escopos concorrentes do Namespace
 *
 * Para quaisquer dois escopos criados por `run`, um valor armazenado em um escopo
 * não é acessível a partir de outro escopo, e cada escopo observa apenas os valores
 * nele armazenados.
 *
 * A verificação usa interleaving assíncrono: cada escopo é aberto via `run`,
 * armazena seu próprio valor e, após uma suspensão assíncrona (que cede o controle
 * ao event loop e, portanto, aos demais escopos), relê o valor. Como o
 * `AsyncLocalStorage` preserva o contexto por cadeia assíncrona, cada escopo deve
 * reler exatamente o que armazenou, sem vazamento entre escopos concorrentes (R2.1).
 *
 * Validates: Requirements 2.1
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Namespace } from './namespace';

const NUM_RUNS = 100;

/**
 * Cede o controle ao event loop por um atraso arbitrário (em ticks de macrotask),
 * forçando o entrelaçamento das execuções de múltiplos escopos de `run`.
 */
function yieldFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Abre um escopo isolado via `run`, armazena `correlationId`/`keyId`, suspende a
 * execução (permitindo que outros escopos concorrentes rodem no intervalo) e, ao
 * retomar, relê os valores observados no próprio escopo. Também captura a leitura
 * feita FORA de qualquer escopo imediatamente após a suspensão, para garantir que
 * nada vazou para o contexto raiz.
 */
function runScope(
  namespace: Namespace,
  requestId: string,
  keyId: string,
  delay: number,
): Promise<{ observedRequestId: string | null; observedKeyId: string | undefined }> {
  return new Promise((resolve) => {
    namespace.run(() => {
      namespace.setRequestId(requestId);
      namespace.setkeyId(keyId);

      // Suspensão assíncrona dentro do escopo: o AsyncLocalStorage deve manter o
      // contexto desta cadeia mesmo após o yield, apesar de outros escopos rodarem.
      void yieldFor(delay).then(() => {
        resolve({
          observedRequestId: namespace.getRequestId<string>(),
          observedKeyId: namespace.getkeyId<string>(),
        });
      });
    });
  });
}

describe('Property 7: Isolamento entre escopos concorrentes do Namespace', () => {
  it('cada escopo observa apenas o valor nele armazenado, sem vazamento entre escopos', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pares (requestId, keyId, delay) distintos por escopo. Delays variados
        // garantem ordem de retomada diferente da ordem de criação.
        fc.array(
          fc.record({
            requestId: fc.string({ minLength: 1 }),
            keyId: fc.string({ minLength: 1 }),
            delay: fc.integer({ min: 0, max: 5 }),
          }),
          { minLength: 2, maxLength: 6 },
        ),
        async (scopes) => {
          // Instância isolada por iteração para evitar estado residual entre runs.
          const namespace = new Namespace();

          // Marcadores únicos por índice para distinguir cada escopo de forma
          // inequívoca, mesmo que fast-check gere valores repetidos.
          const expected = scopes.map((scope, index) => ({
            requestId: `${scope.requestId}#req-${index}`,
            keyId: `${scope.keyId}#key-${index}`,
            delay: scope.delay,
          }));

          // Dispara todos os escopos de forma concorrente (interleaved).
          const results = await Promise.all(
            expected.map((scope) =>
              runScope(namespace, scope.requestId, scope.keyId, scope.delay),
            ),
          );

          // Cada escopo relê exatamente os valores que armazenou — nenhum vazamento.
          results.forEach((result, index) => {
            expect(result.observedRequestId).toBe(expected[index].requestId);
            expect(result.observedKeyId).toBe(expected[index].keyId);
          });

          // Fora de qualquer escopo, nada é observável (contexto raiz permanece vazio).
          expect(namespace.getRequestId<string>()).toBeNull();
          expect(namespace.getkeyId<string>()).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('escopos sequenciais não compartilham valores (cada run parte de um store vazio)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (firstId, secondId) => {
          const namespace = new Namespace();

          // Primeiro escopo armazena e encerra.
          const firstObserved = await runScope(namespace, firstId, `${firstId}-key`, 1);
          expect(firstObserved.observedRequestId).toBe(firstId);

          // Entre escopos, o contexto raiz permanece vazio (sem vazamento do 1º).
          expect(namespace.getRequestId<string>()).toBeNull();

          // Segundo escopo parte de um store novo e observa apenas o seu valor.
          const secondObserved = await runScope(namespace, secondId, `${secondId}-key`, 1);
          expect(secondObserved.observedRequestId).toBe(secondId);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

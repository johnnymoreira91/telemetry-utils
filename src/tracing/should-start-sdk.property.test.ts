/**
 * Teste de propriedade — decisão de ativação do Node_SDK por `KUBERNETES`.
 *
 * Feature: telemetry-utils, Property 19: Decisão de ativação do SDK por KUBERNETES
 *
 * Para qualquer valor da variável de ambiente `KUBERNETES`, a decisão de iniciar
 * o Node_SDK é verdadeira se e somente se o valor é exatamente a string `'true'`;
 * para qualquer outro valor (ausente ou diferente), o SDK não é iniciado e o
 * modo local é adotado.
 *
 * Validates: Requirements 9.4, 9.5
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { shouldStartSdk } from './should-start-sdk';

const NUM_RUNS = 100;

/**
 * Gerador de valores que NÃO são exatamente a string `'true'`.
 *
 * Combina uma string arbitrária (filtrando o único valor positivo `'true'`) com
 * `undefined` (env ausente) e um conjunto de casos de borda próximos ao valor
 * positivo — variações de caixa, espaços, representações booleanas alternativas
 * — que são justamente os valores mais propensos a serem aceitos por engano.
 */
const notExactlyTrueArb = fc.oneof(
  fc.string().filter((value) => value !== 'true'),
  fc.constantFrom<string | undefined>(
    undefined,
    'TRUE',
    'True',
    'tRue',
    ' true',
    'true ',
    '1',
    '0',
    '',
    'false',
    'yes',
    'no',
    'y',
    'n',
    'on',
    'off',
  ),
);

describe('Property 19: Decisão de ativação do SDK por KUBERNETES', () => {
  it('retorna verdadeiro se e somente se o valor é exatamente a string "true"', () => {
    fc.assert(
      fc.property(notExactlyTrueArb, (value) => {
        // Qualquer valor diferente da string exata `'true'` (incluindo ausência,
        // variações de caixa e representações booleanas alternativas) não ativa
        // o SDK (R9.5).
        expect(shouldStartSdk(value)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('ativa o SDK para o valor exato "true"', () => {
    // Caso positivo dedicado: somente a string exata `'true'` ativa o SDK (R9.4).
    expect(shouldStartSdk('true')).toBe(true);
  });

  it('verdadeiro sse valor é exatamente "true" sobre qualquer entrada arbitrária', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: undefined }),
        (value) => {
          // Bicondicional explícita (iff): a decisão é verdadeira exatamente
          // quando a entrada é a string `'true'` e falsa em todos os demais casos.
          expect(shouldStartSdk(value)).toBe(value === 'true');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

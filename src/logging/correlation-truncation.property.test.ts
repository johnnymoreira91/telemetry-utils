/**
 * Teste de propriedade — truncamento do Correlation_Id na saída estilizada.
 *
 * Feature: telemetry-utils, Property 3: Truncamento do Correlation_Id
 *
 * Para qualquer Correlation_Id, a representação exibida no formato estilizado é
 * composta pelos últimos 7 caracteres quando o identificador possui mais de 7
 * caracteres, e pelo identificador integral quando possui 7 caracteres ou menos.
 *
 * Validates: Requirements 1.4
 */

import fc from 'fast-check';
import { MESSAGE } from 'triple-beam';
import type { Logform } from 'winston';
import { describe, expect, it } from 'vitest';

import { WinstonLogger } from './winston-logger';

const NUM_RUNS = 100;

/** Estágio arbitrário usado no prefixo `[stage-service]`; irrelevante para a propriedade. */
const STAGE = 'prod';

/**
 * Representação esperada do Correlation_Id na linha estilizada (R1.4):
 * - últimos 7 caracteres quando o id possui mais de 7 caracteres;
 * - o id integral quando possui 7 caracteres ou menos.
 */
function expectedTruncation(correlationId: string): string {
  return correlationId.length > 7 ? correlationId.slice(-7) : correlationId;
}

/**
 * Produz a linha estilizada final a partir de um registro `info`, invocando o
 * `transform` do formato `printf` retornado por `formatPrint(stage)`. O winston
 * deposita o texto renderizado no símbolo `MESSAGE` do objeto `info`.
 */
function renderLine(info: Logform.TransformableInfo): string {
  const format = WinstonLogger.formatPrint(STAGE);
  const transformed = format.transform(info, format.options) as Logform.TransformableInfo;
  return String(transformed[MESSAGE as unknown as keyof Logform.TransformableInfo]);
}

describe('Property 3: Truncamento do Correlation_Id', () => {
  it('exibe os últimos 7 caracteres quando o id tem mais de 7 caracteres, ou o id integral caso contrário', () => {
    fc.assert(
      fc.property(
        // Correlation_Id arbitrário, cobrindo ids curtos (<= 7) e longos (> 7).
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        (correlationId, message) => {
          const line = renderLine({
            level: 'info',
            message,
            service: 'svc',
            timestamp: '2024-01-01T00:00:00.000Z',
            correlationId,
          } as unknown as Logform.TransformableInfo);

          const expected = expectedTruncation(correlationId);

          // A representação truncada aparece entre parênteses na linha estilizada.
          expect(line).toContain(`(${expected})`);

          // Garantias estruturais do truncamento:
          if (correlationId.length > 7) {
            // Exatamente 7 caracteres exibidos, correspondendo ao sufixo do id.
            expect(expected).toHaveLength(7);
            expect(correlationId.endsWith(expected)).toBe(true);
          } else {
            // Id integral preservado quando possui 7 caracteres ou menos.
            expect(expected).toBe(correlationId);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserva integralmente ids com exatamente 7 caracteres (borda)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 7, maxLength: 7 }),
        (correlationId) => {
          const line = renderLine({
            level: 'info',
            message: 'msg',
            service: 'svc',
            timestamp: '2024-01-01T00:00:00.000Z',
            correlationId,
          } as unknown as Logform.TransformableInfo);

          expect(line).toContain(`(${correlationId})`);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('exibe apenas os últimos 7 caracteres para ids com 8 caracteres (borda superior)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 8 }),
        (correlationId) => {
          const line = renderLine({
            level: 'info',
            message: 'msg',
            service: 'svc',
            timestamp: '2024-01-01T00:00:00.000Z',
            correlationId,
          } as unknown as Logform.TransformableInfo);

          expect(line).toContain(`(${correlationId.slice(-7)})`);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

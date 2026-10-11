/**
 * Teste de propriedade — presença condicional do transporte Loki.
 *
 * Feature: telemetry-utils, Property 16: Presença condicional do transporte Loki
 *
 * Para qualquer configuração, o transporte Loki é adicionado ao Logger se e
 * somente se `LOKI_TRANSPORT === 'true'`, e o host utilizado é o valor de
 * `LOKI_HOST` quando definido ou o host padrão
 * `http://loki.infra.svc.cluster.local:3100` quando ausente.
 *
 * O LoggerService resolve a configuração no construtor via `loadConfig()`, que
 * lê `process.env`. Para controlar o ambiente por execução do fast-check,
 * salvamos/restauramos `process.env` ao redor de cada construção: definimos
 * `LOKI_TRANSPORT`/`LOKI_HOST`, construímos o logger, inspecionamos
 * `logger.transports` em busca de uma instância de `LokiTransport` e, ao final,
 * restauramos o ambiente e fechamos o logger (o transporte Loki inicia um loop
 * de batching que precisa ser encerrado).
 *
 * O host efetivo é lido diretamente da instância do transporte Loki
 * (`transport.batcher.options.host`), que é onde o `winston-loki` o armazena.
 *
 * Validates: Requirements 6.6, 6.7, 6.8
 */

import * as fc from 'fast-check';
import LokiTransport from 'winston-loki';
import { afterEach, describe, expect, it } from 'vitest';

import { LoggerService } from './logger-service';

const NUM_RUNS = 100;

/** Host padrão do Loki aplicado quando `LOKI_HOST` está ausente (R6.8). */
const DEFAULT_LOKI_HOST = 'http://loki.infra.svc.cluster.local:3100';

/** Variáveis de ambiente manipuladas pelo teste, salvas/restauradas por execução. */
const MANAGED_ENV_KEYS = ['LOKI_TRANSPORT', 'LOKI_HOST'] as const;

let activeLogger: LoggerService | undefined;

afterEach(() => {
  activeLogger?.close();
  activeLogger = undefined;
});

/** Localiza a instância de `LokiTransport` entre os transportes do logger, se houver. */
function findLokiTransport(logger: LoggerService): LokiTransport | undefined {
  return logger.transports.find(
    (transport): transport is LokiTransport => transport instanceof LokiTransport,
  );
}

/** Lê o host efetivo armazenado pela instância do transporte Loki. */
function hostOf(transport: LokiTransport): unknown {
  return (transport as unknown as { batcher: { options: { host: string } } }).batcher.options.host;
}

/**
 * Constrói um LoggerService com o ambiente Loki informado, isolando e
 * restaurando `process.env`. Retorna informações observáveis sobre a presença e
 * o host do transporte Loki. O logger é fechado após a inspeção.
 *
 * @param lokiTransport Valor a atribuir a `LOKI_TRANSPORT` (ou ausência quando `undefined`).
 * @param lokiHost Valor a atribuir a `LOKI_HOST` (ou ausência quando `undefined`).
 */
function buildAndInspect(
  lokiTransport: string | undefined,
  lokiHost: string | undefined,
): { present: boolean; host: unknown } {
  const saved: Record<string, string | undefined> = {};
  for (const key of MANAGED_ENV_KEYS) {
    saved[key] = process.env[key];
  }

  try {
    if (lokiTransport === undefined) {
      delete process.env.LOKI_TRANSPORT;
    } else {
      process.env.LOKI_TRANSPORT = lokiTransport;
    }

    if (lokiHost === undefined) {
      delete process.env.LOKI_HOST;
    } else {
      process.env.LOKI_HOST = lokiHost;
    }

    const logger = new LoggerService('loki-prop-test');
    activeLogger = logger;

    const lokiTransportInstance = findLokiTransport(logger);
    const result = {
      present: lokiTransportInstance !== undefined,
      host: lokiTransportInstance !== undefined ? hostOf(lokiTransportInstance) : undefined,
    };

    logger.close();
    activeLogger = undefined;

    return result;
  } finally {
    for (const key of MANAGED_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

/**
 * Gerador de valor para `LOKI_TRANSPORT`: inclui o único valor habilitador
 * (`'true'`), ausência (`undefined`) e diversos valores que NÃO devem habilitar
 * o transporte (incluindo variações de caixa e strings arbitrárias).
 */
const lokiTransportArb = fc.oneof(
  fc.constant<string | undefined>('true'),
  fc.constant<string | undefined>(undefined),
  fc.constantFrom<string>('false', 'TRUE', 'True', '1', '0', 'yes', '', 'enabled'),
  fc.string(),
);

/**
 * Gerador de valor para `LOKI_HOST`: ausência (`undefined`) ou uma URL de host
 * não-vazia arbitrária (restringida ao espaço de entrada relevante).
 */
const lokiHostArb = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc
    .webUrl()
    .filter((url) => url.length > 0)
    .map((url) => url),
);

describe('Property 16: Presença condicional do transporte Loki', () => {
  it('adiciona o transporte Loki se e somente se LOKI_TRANSPORT === "true"', () => {
    fc.assert(
      fc.property(lokiTransportArb, lokiHostArb, (lokiTransport, lokiHost) => {
        const { present } = buildAndInspect(lokiTransport, lokiHost);
        const shouldBePresent = lokiTransport === 'true';

        expect(present).toBe(shouldBePresent);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('usa LOKI_HOST quando definido e o host padrão quando ausente (com LOKI_TRANSPORT="true")', () => {
    fc.assert(
      fc.property(lokiHostArb, (lokiHost) => {
        const { present, host } = buildAndInspect('true', lokiHost);

        expect(present).toBe(true);
        const expectedHost = lokiHost === undefined ? DEFAULT_LOKI_HOST : lokiHost;
        expect(host).toBe(expectedHost);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('nunca adiciona o transporte Loki quando LOKI_TRANSPORT difere de "true"', () => {
    fc.assert(
      fc.property(
        lokiTransportArb.filter((value) => value !== 'true'),
        lokiHostArb,
        (lokiTransport, lokiHost) => {
          const { present } = buildAndInspect(lokiTransport, lokiHost);

          expect(present).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

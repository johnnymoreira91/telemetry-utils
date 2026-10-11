/**
 * Teste de propriedade — aplicação de defaults de variáveis de ambiente.
 *
 * Feature: telemetry-utils, Property 12: Aplicação de defaults de variáveis de ambiente
 *
 * Para qualquer subconjunto de variáveis de ambiente ausentes dentre
 * `APPLICATION_NAME`, `APP_STAGE` e os endpoints OTLP por sinal, a configuração
 * resolvida aplica exatamente o valor padrão correspondente para cada variável
 * ausente e preserva o valor fornecido para as presentes.
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadConfig } from './env';

const NUM_RUNS = 100;

// Defaults esperados conforme a tabela de design (Data Models — R7.3, R7.4, R7.5).
const DEFAULT_APPLICATION_NAME = 'unknown-service';
const DEFAULT_STAGE = 'unknown-stage';
const DEFAULT_OTLP_BASE = 'http://otel-collector.infra.svc.cluster.local:4318';
const DEFAULT_OTLP_ENDPOINTS = {
  traces: `${DEFAULT_OTLP_BASE}/v1/traces`,
  logs: `${DEFAULT_OTLP_BASE}/v1/logs`,
  metrics: `${DEFAULT_OTLP_BASE}/v1/metrics`,
} as const;

/**
 * Gerador de valor fornecido para uma env: ou ausente (`undefined`), ou uma
 * string não-vazia arbitrária. A ausência deve disparar o default; a presença
 * deve ser preservada integralmente.
 */
const optionalValueArb = fc.option(fc.string({ minLength: 1 }), { nil: undefined });

/**
 * Monta um objeto de ambiente sintético contendo apenas as variáveis cujos
 * valores foram efetivamente fornecidos (não `undefined`). Variáveis ausentes
 * simplesmente não aparecem no objeto, reproduzindo o comportamento real de
 * `process.env`.
 */
function buildEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

describe('Property 12: Aplicação de defaults de variáveis de ambiente', () => {
  it('aplica o default para cada variável ausente e preserva o valor das presentes', () => {
    fc.assert(
      fc.property(
        optionalValueArb, // APPLICATION_NAME
        optionalValueArb, // APP_STAGE
        optionalValueArb, // OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
        optionalValueArb, // OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
        optionalValueArb, // OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
        (appName, stage, tracesEndpoint, logsEndpoint, metricsEndpoint) => {
          const env = buildEnv({
            APPLICATION_NAME: appName,
            APP_STAGE: stage,
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: tracesEndpoint,
            OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: logsEndpoint,
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsEndpoint,
          });

          const config = loadConfig(env);

          // APPLICATION_NAME (R7.4): default `unknown-service` quando ausente.
          expect(config.applicationName).toBe(
            appName === undefined ? DEFAULT_APPLICATION_NAME : appName,
          );

          // APP_STAGE (R7.5): default `unknown-stage` quando ausente.
          expect(config.stage).toBe(stage === undefined ? DEFAULT_STAGE : stage);

          // Endpoints OTLP por sinal (R7.3): default `.../v1/{signal}` quando ausente.
          expect(config.otlpEndpoints.traces).toBe(
            tracesEndpoint === undefined ? DEFAULT_OTLP_ENDPOINTS.traces : tracesEndpoint,
          );
          expect(config.otlpEndpoints.logs).toBe(
            logsEndpoint === undefined ? DEFAULT_OTLP_ENDPOINTS.logs : logsEndpoint,
          );
          expect(config.otlpEndpoints.metrics).toBe(
            metricsEndpoint === undefined ? DEFAULT_OTLP_ENDPOINTS.metrics : metricsEndpoint,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('aplica todos os defaults simultaneamente quando o ambiente está vazio', () => {
    const config = loadConfig(buildEnv({}));

    expect(config.applicationName).toBe(DEFAULT_APPLICATION_NAME);
    expect(config.stage).toBe(DEFAULT_STAGE);
    expect(config.otlpEndpoints.traces).toBe(DEFAULT_OTLP_ENDPOINTS.traces);
    expect(config.otlpEndpoints.logs).toBe(DEFAULT_OTLP_ENDPOINTS.logs);
    expect(config.otlpEndpoints.metrics).toBe(DEFAULT_OTLP_ENDPOINTS.metrics);
  });

  it('preserva integralmente todos os valores fornecidos quando o ambiente está completo', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (appName, stage, tracesEndpoint, logsEndpoint, metricsEndpoint) => {
          const config = loadConfig(
            buildEnv({
              APPLICATION_NAME: appName,
              APP_STAGE: stage,
              OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: tracesEndpoint,
              OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: logsEndpoint,
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsEndpoint,
            }),
          );

          expect(config.applicationName).toBe(appName);
          expect(config.stage).toBe(stage);
          expect(config.otlpEndpoints.traces).toBe(tracesEndpoint);
          expect(config.otlpEndpoints.logs).toBe(logsEndpoint);
          expect(config.otlpEndpoints.metrics).toBe(metricsEndpoint);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

/**
 * Teste de propriedade — independência dos endpoints OTLP por sinal.
 *
 * Feature: telemetry-utils, Property 13: Independência dos endpoints OTLP por sinal
 *
 * Para qualquer combinação de valores dos endpoints de traces, logs e métricas,
 * a configuração resolvida de cada sinal reflete exclusivamente a variável de
 * ambiente daquele sinal, sem interferência das demais.
 *
 * Validates: Requirements 7.2
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadConfig } from './env';

const NUM_RUNS = 100;

/** Base do coletor OTLP da infraestrutura usada para compor os endpoints padrão (R7.3). */
const DEFAULT_OTLP_BASE = 'http://otel-collector.infra.svc.cluster.local:4318';

/** Endpoints OTLP padrão, independentes por sinal (R7.2, R7.3). */
const DEFAULT_OTLP_ENDPOINTS = {
  traces: `${DEFAULT_OTLP_BASE}/v1/traces`,
  logs: `${DEFAULT_OTLP_BASE}/v1/logs`,
  metrics: `${DEFAULT_OTLP_BASE}/v1/metrics`,
} as const;

/**
 * Gerador de valor de endpoint OTLP. Cobre strings arbitrárias (incluindo
 * vazias e URLs plausíveis) e o caso ausente (`undefined`), de modo que cada
 * sinal possa, independentemente, ter ou não um endpoint explícito.
 */
const endpointValueArb = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.webUrl(),
  fc.string(),
);

/**
 * Resolve o endpoint esperado para um único sinal: o próprio valor quando a env
 * está presente, ou o default correspondente quando ausente (`undefined`).
 */
function expectedEndpoint(
  raw: string | undefined,
  signal: 'traces' | 'logs' | 'metrics',
): string {
  return raw === undefined ? DEFAULT_OTLP_ENDPOINTS[signal] : raw;
}

describe('Property 13: Independência dos endpoints OTLP por sinal', () => {
  it('cada endpoint resolvido reflete exclusivamente sua própria env, sem interferência das demais', () => {
    fc.assert(
      fc.property(
        endpointValueArb,
        endpointValueArb,
        endpointValueArb,
        (tracesRaw, logsRaw, metricsRaw) => {
          // Env sintético contendo apenas (quando definidas) as três envs de
          // endpoint OTLP por sinal. Chaves ausentes permanecem `undefined`.
          const env: NodeJS.ProcessEnv = {};
          if (tracesRaw !== undefined) env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = tracesRaw;
          if (logsRaw !== undefined) env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = logsRaw;
          if (metricsRaw !== undefined) env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = metricsRaw;

          const { otlpEndpoints } = loadConfig(env);

          // Cada sinal reflete exclusivamente sua própria env (ou default).
          expect(otlpEndpoints.traces).toBe(expectedEndpoint(tracesRaw, 'traces'));
          expect(otlpEndpoints.logs).toBe(expectedEndpoint(logsRaw, 'logs'));
          expect(otlpEndpoints.metrics).toBe(expectedEndpoint(metricsRaw, 'metrics'));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('alterar a env de um único sinal não afeta os endpoints resolvidos dos demais', () => {
    fc.assert(
      fc.property(
        // Env base: todas as três envs presentes.
        endpointValueArb.map((v) => v ?? ''),
        endpointValueArb.map((v) => v ?? ''),
        endpointValueArb.map((v) => v ?? ''),
        // Sinal a ser perturbado e novo valor atribuído a ele.
        fc.constantFrom<'traces' | 'logs' | 'metrics'>('traces', 'logs', 'metrics'),
        fc.string(),
        (tracesBase, logsBase, metricsBase, perturbed, newValue) => {
          const baseEnv: NodeJS.ProcessEnv = {
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: tracesBase,
            OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: logsBase,
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsBase,
          };

          const before = loadConfig(baseEnv).otlpEndpoints;

          const envVarBySignal = {
            traces: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
            logs: 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
            metrics: 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
          } as const;

          const perturbedEnv: NodeJS.ProcessEnv = {
            ...baseEnv,
            [envVarBySignal[perturbed]]: newValue,
          };

          const after = loadConfig(perturbedEnv).otlpEndpoints;

          // O sinal perturbado reflete exatamente o novo valor.
          expect(after[perturbed]).toBe(newValue);

          // Os demais sinais permanecem inalterados (sem interferência).
          for (const signal of ['traces', 'logs', 'metrics'] as const) {
            if (signal !== perturbed) {
              expect(after[signal]).toBe(before[signal]);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

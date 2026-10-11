/**
 * Teste de propriedade — resolução do host efetivo por Export_Target.
 *
 * Feature: telemetry-utils, Property 15: Resolução do host efetivo por Export_Target
 *
 * Para qualquer sinal exportável e Export_Target válido, o host/endpoint
 * efetivo resolvido para o exportador OTLP HTTP corresponde ao Host associado
 * ao destino selecionado (`alloy` ou `otlp`).
 *
 * Validates: Requirements 6.2, 6.3
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  resolveEffectiveEndpoint,
  resolveEndpointsByTarget,
  type EffectiveEndpointsByTarget,
  type ExportableSignal,
} from './env';
import { EXPORT_TARGETS, type ExportTarget, type TelemetryConfig } from '../types';

const NUM_RUNS = 100;

/** Sinais exportáveis cujo host efetivo é selecionável por Export_Target. */
const EXPORTABLE_SIGNALS: readonly ExportableSignal[] = ['traces', 'metrics'] as const;

/** Gerador de sinal exportável. */
const signalArb = fc.constantFrom(...EXPORTABLE_SIGNALS);

/** Gerador de Export_Target válido (`alloy` | `otlp`). */
const targetArb = fc.constantFrom<ExportTarget>(...EXPORT_TARGETS);

/** Gerador de URL-like host/endpoint (string não vazia). */
const endpointArb = fc.webUrl();

/**
 * Monta uma `TelemetryConfig` mínima parametrizada pelos Export_Target por
 * sinal e pelos endpoints OTLP por sinal. Apenas os campos relevantes à
 * resolução do host efetivo são variados; os demais recebem valores fixos.
 */
function makeConfig(params: {
  tracesTarget: ExportTarget;
  metricsTarget: ExportTarget;
  otlpTraces: string;
  otlpMetrics: string;
  otlpLogs: string;
}): TelemetryConfig {
  return {
    applicationName: 'svc',
    stage: 'test',
    serviceNamespace: 'ns',
    logLevel: 'info',
    logFormat: 'text',
    lokiTransport: false,
    lokiHost: 'http://loki.local:3100',
    kubernetes: false,
    otelLogLevel: 'WARN',
    otlpEndpoints: {
      traces: params.otlpTraces,
      logs: params.otlpLogs,
      metrics: params.otlpMetrics,
    },
    exportTargets: {
      traces: params.tracesTarget,
      metrics: params.metricsTarget,
    },
  };
}

describe('Property 15: Resolução do host efetivo por Export_Target', () => {
  it('o host efetivo corresponde exatamente ao endpoint do destino selecionado para o sinal', () => {
    fc.assert(
      fc.property(
        signalArb,
        targetArb,
        targetArb,
        // Endpoints distintos por destino/sinal para evidenciar a seleção.
        fc.record({
          alloyTraces: endpointArb,
          alloyMetrics: endpointArb,
          otlpTraces: endpointArb,
          otlpMetrics: endpointArb,
          otlpLogs: endpointArb,
        }),
        (signal, tracesTarget, metricsTarget, eps) => {
          const config = makeConfig({
            tracesTarget,
            metricsTarget,
            otlpTraces: eps.otlpTraces,
            otlpMetrics: eps.otlpMetrics,
            otlpLogs: eps.otlpLogs,
          });

          const endpoints: EffectiveEndpointsByTarget = {
            alloy: { traces: eps.alloyTraces, metrics: eps.alloyMetrics },
            otlp: { traces: eps.otlpTraces, metrics: eps.otlpMetrics },
          };

          const resolved = resolveEffectiveEndpoint(config, signal, endpoints);

          // O destino efetivamente selecionado para ESTE sinal.
          const selectedTarget = config.exportTargets[signal];

          // (R6.2/R6.3) O host efetivo é exatamente o do destino selecionado.
          expect(resolved).toBe(endpoints[selectedTarget][signal]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('o host efetivo nunca corresponde ao destino NÃO selecionado quando os hosts diferem', () => {
    fc.assert(
      fc.property(
        signalArb,
        targetArb,
        targetArb,
        fc.record({
          alloyTraces: endpointArb,
          alloyMetrics: endpointArb,
          otlpTraces: endpointArb,
          otlpMetrics: endpointArb,
          otlpLogs: endpointArb,
        }),
        (signal, tracesTarget, metricsTarget, eps) => {
          const config = makeConfig({
            tracesTarget,
            metricsTarget,
            otlpTraces: eps.otlpTraces,
            otlpMetrics: eps.otlpMetrics,
            otlpLogs: eps.otlpLogs,
          });

          const endpoints: EffectiveEndpointsByTarget = {
            alloy: { traces: eps.alloyTraces, metrics: eps.alloyMetrics },
            otlp: { traces: eps.otlpTraces, metrics: eps.otlpMetrics },
          };

          const selectedTarget = config.exportTargets[signal];
          const otherTarget: ExportTarget = selectedTarget === 'alloy' ? 'otlp' : 'alloy';

          const resolved = resolveEffectiveEndpoint(config, signal, endpoints);

          // Pré-condição: hosts do sinal diferem entre destinos.
          fc.pre(endpoints.alloy[signal] !== endpoints.otlp[signal]);

          expect(resolved).not.toBe(endpoints[otherTarget][signal]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('a resolução é independente entre sinais: cada sinal usa o host do seu próprio target', () => {
    fc.assert(
      fc.property(
        targetArb,
        targetArb,
        fc.record({
          alloyTraces: endpointArb,
          alloyMetrics: endpointArb,
          otlpTraces: endpointArb,
          otlpMetrics: endpointArb,
          otlpLogs: endpointArb,
        }),
        (tracesTarget, metricsTarget, eps) => {
          const config = makeConfig({
            tracesTarget,
            metricsTarget,
            otlpTraces: eps.otlpTraces,
            otlpMetrics: eps.otlpMetrics,
            otlpLogs: eps.otlpLogs,
          });

          const endpoints: EffectiveEndpointsByTarget = {
            alloy: { traces: eps.alloyTraces, metrics: eps.alloyMetrics },
            otlp: { traces: eps.otlpTraces, metrics: eps.otlpMetrics },
          };

          const resolvedTraces = resolveEffectiveEndpoint(config, 'traces', endpoints);
          const resolvedMetrics = resolveEffectiveEndpoint(config, 'metrics', endpoints);

          expect(resolvedTraces).toBe(endpoints[tracesTarget].traces);
          expect(resolvedMetrics).toBe(endpoints[metricsTarget].metrics);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolveEndpointsByTarget mantém os endpoints OTLP da config e deriva os do Alloy a partir do ambiente', () => {
    fc.assert(
      fc.property(
        fc.record({
          otlpTraces: endpointArb,
          otlpMetrics: endpointArb,
          otlpLogs: endpointArb,
        }),
        (eps) => {
          const config = makeConfig({
            tracesTarget: 'otlp',
            metricsTarget: 'otlp',
            otlpTraces: eps.otlpTraces,
            otlpMetrics: eps.otlpMetrics,
            otlpLogs: eps.otlpLogs,
          });

          // Ambiente vazio: Alloy cai no host padrão; OTLP vem da config.
          const derived = resolveEndpointsByTarget(config, {});

          expect(derived.otlp.traces).toBe(eps.otlpTraces);
          expect(derived.otlp.metrics).toBe(eps.otlpMetrics);
          expect(derived.alloy.traces).toContain('/v1/traces');
          expect(derived.alloy.metrics).toContain('/v1/metrics');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

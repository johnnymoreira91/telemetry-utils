/**
 * Teste de propriedade — vínculo de contexto pai/filho de Spans.
 *
 * Feature: telemetry-utils, Property 18: Vínculo de contexto pai/filho de Spans
 *
 * Para qualquer criação de Span, quando existe um Span ativo o novo Span é
 * vinculado ao Trace_Context do pai (compartilhando o mesmo `traceId`); na
 * ausência de Span ativo, o novo Span é criado como raiz de um novo
 * Trace_Context.
 *
 * Validates: Requirements 5.4
 *
 * NOTA DE INFRAESTRUTURA DE TESTE:
 * O `@opentelemetry/api` isolado (sem um SDK/TracerProvider registrado) retorna
 * Spans no-op NÃO gravadores, cujo `spanContext()` possui `traceId` inválido
 * (zeros) e não propaga contexto. Para exercitar o vínculo real pai/filho, este
 * teste registra um TracerProvider em memória (`BasicTracerProvider` +
 * `InMemorySpanExporter` via `SimpleSpanProcessor`) e um
 * `AsyncLocalStorageContextManager` como gerenciador de contexto global — este
 * último é o que permite que `startActiveSpan` propague o Span ativo para o
 * `startSpan`/`startActiveSpan` filho.
 */

import {
  context,
  trace,
  type Span,
  INVALID_SPAN_CONTEXT,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import * as fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TracerProvider } from './tracer-provider';
import type { TelemetryConfig } from '../types';

const NUM_RUNS = 100;

/** Padrão de `traceId` válido do OpenTelemetry: 32 hex, diferente de só-zeros. */
const VALID_TRACE_ID = /^[0-9a-f]{32}$/;
const ZERO_TRACE_ID = '00000000000000000000000000000000';

/**
 * Monta uma `TelemetryConfig` mínima. Apenas `applicationName` importa aqui,
 * pois é usado para obter o tracer nomeado; os demais campos recebem valores
 * fixos e neutros.
 */
function makeConfig(): TelemetryConfig {
  return {
    applicationName: 'span-parent-child-test',
    stage: 'test',
    serviceNamespace: 'ns',
    logLevel: 'info',
    logFormat: 'text',
    lokiTransport: false,
    lokiHost: 'http://loki.local:3100',
    kubernetes: false,
    otelLogLevel: 'WARN',
    otlpEndpoints: {
      traces: 'http://otel.local:4318/v1/traces',
      logs: 'http://otel.local:4318/v1/logs',
      metrics: 'http://otel.local:4318/v1/metrics',
    },
    exportTargets: {
      traces: 'otlp',
      metrics: 'otlp',
    },
  };
}

/** Gerador de nome de operação válido (1..255 chars) sem caracteres nulos. */
const spanNameArb = fc
  .string({ minLength: 1, maxLength: 255 })
  .filter((s) => s.length >= 1 && s.length <= 255);

describe('Property 18: Vínculo de contexto pai/filho de Spans', () => {
  let sdkProvider: BasicTracerProvider;
  let contextManager: AsyncLocalStorageContextManager;
  let provider: TracerProvider;

  beforeAll(() => {
    // SDK em memória: produz Spans gravadores com spanContext() válido.
    const exporter = new InMemorySpanExporter();
    sdkProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    // Gerenciador de contexto: habilita a propagação do Span ativo entre
    // startActiveSpan (pai) e startSpan/startActiveSpan (filho).
    contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();

    trace.setGlobalTracerProvider(sdkProvider);
    context.setGlobalContextManager(contextManager);

    provider = new TracerProvider(makeConfig());
  });

  afterAll(async () => {
    contextManager.disable();
    context.disable();
    trace.disable();
    await sdkProvider.shutdown();
  });

  it('o Span filho criado via startSpan dentro de um Span ativo compartilha o traceId do pai', () => {
    fc.assert(
      fc.property(spanNameArb, spanNameArb, (parentName, childName) => {
        provider.startActiveSpan(parentName, (parent: Span) => {
          const parentCtx = parent.spanContext();

          // O filho é criado DENTRO do contexto ativo do pai.
          const child = provider.startSpan(childName);
          const childCtx = child.spanContext();

          try {
            // (R5.4) traceId compartilhado: o filho está no mesmo trace do pai.
            expect(childCtx.traceId).toBe(parentCtx.traceId);
            // O filho é um span distinto (spanId próprio).
            expect(childCtx.spanId).not.toBe(parentCtx.spanId);
            // traceId do pai é válido (span gravador do SDK).
            expect(parentCtx.traceId).toMatch(VALID_TRACE_ID);
            expect(parentCtx.traceId).not.toBe(ZERO_TRACE_ID);
          } finally {
            child.end();
            parent.end();
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('o Span filho criado via startActiveSpan aninhado compartilha o traceId do pai', () => {
    fc.assert(
      fc.property(spanNameArb, spanNameArb, (parentName, childName) => {
        provider.startActiveSpan(parentName, (parent: Span) => {
          const parentCtx = parent.spanContext();

          provider.startActiveSpan(childName, (child: Span) => {
            const childCtx = child.spanContext();
            try {
              // (R5.4) O filho ativo herda o Trace_Context do pai ativo.
              expect(childCtx.traceId).toBe(parentCtx.traceId);
              expect(childCtx.spanId).not.toBe(parentCtx.spanId);
            } finally {
              child.end();
            }
          });

          parent.end();
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('na ausência de Span ativo, cada novo Span é raiz de um novo Trace_Context (traceId válido e único)', () => {
    fc.assert(
      fc.property(spanNameArb, spanNameArb, (nameA, nameB) => {
        // Fora de qualquer startActiveSpan: não há Span ativo no contexto.
        const rootA = provider.startSpan(nameA);
        const rootB = provider.startSpan(nameB);
        const ctxA = rootA.spanContext();
        const ctxB = rootB.spanContext();

        try {
          // (R5.4) Cada span raiz possui um traceId válido e próprio.
          expect(ctxA.traceId).toMatch(VALID_TRACE_ID);
          expect(ctxB.traceId).toMatch(VALID_TRACE_ID);
          expect(ctxA.traceId).not.toBe(ZERO_TRACE_ID);
          expect(ctxB.traceId).not.toBe(ZERO_TRACE_ID);
          // Dois spans raiz independentes abrem traces distintos.
          expect(ctxA.traceId).not.toBe(ctxB.traceId);
          // Nenhum herda o traceId inválido do contexto no-op.
          expect(ctxA.traceId).not.toBe(INVALID_SPAN_CONTEXT.traceId);
        } finally {
          rootA.end();
          rootB.end();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('um Span raiz e um Span filho de um pai ativo pertencem a traces diferentes', () => {
    fc.assert(
      fc.property(spanNameArb, spanNameArb, (parentName, childName) => {
        // Span raiz, fora de qualquer contexto ativo.
        const root = provider.startSpan(parentName);
        const rootTraceId = root.spanContext().traceId;
        root.end();

        // Span filho dentro de um pai ativo: trace próprio do pai ativo.
        provider.startActiveSpan(parentName, (parent: Span) => {
          const child = provider.startSpan(childName);
          try {
            expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
            // O trace do pai ativo é distinto do trace do span raiz anterior.
            expect(child.spanContext().traceId).not.toBe(rootTraceId);
          } finally {
            child.end();
            parent.end();
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

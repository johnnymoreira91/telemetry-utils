/**
 * Teste de propriedade — campos de tracing condicionados ao Span ativo.
 *
 * Feature: telemetry-utils, Property 9: Campos de tracing condicionados ao Span ativo
 *
 * Para qualquer registro de log, os campos `traceId` e `spanId` estão presentes
 * se e somente se existe um Span ativo no momento da emissão.
 *
 * Validates: Requirements 3.1, 3.2
 *
 * NOTA DE INFRAESTRUTURA DE TESTE:
 * O `@opentelemetry/api` isolado (sem um SDK/TracerProvider registrado) retorna
 * Spans no-op NÃO gravadores, cujo `spanContext()` possui `traceId`/`spanId`
 * inválidos (zeros) e que não propagam contexto. Como o `otelFormat` do
 * LoggerService injeta `traceId`/`spanId` a partir de `trace.getActiveSpan()`,
 * exercitar a condicional real exige um Span ativo com contexto válido. Por
 * isso este teste registra um TracerProvider em memória (`BasicTracerProvider`
 * + `InMemorySpanExporter` via `SimpleSpanProcessor`) e um
 * `AsyncLocalStorageContextManager` como gerenciador de contexto global — este
 * último é o que faz `startActiveSpan` propagar o Span ativo para
 * `trace.getActiveSpan()` durante a emissão do log.
 *
 * CAPTURA DE REGISTROS:
 * Um transporte winston in-memory é anexado a um `LoggerService` com
 * `LOG_FORMAT=json`. O formato combinado do logger (`otelFormat` + contexto +
 * timestamp + json) renderiza o registro final em `info[Symbol.for('message')]`
 * como JSON, que é parseado para inspecionar a presença/ausência de
 * `traceId`/`spanId`.
 */

import { context, trace, type Span } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import * as fc from 'fast-check';
import * as winston from 'winston';
import Transport from 'winston-transport';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LoggerService } from './logger-service';

const NUM_RUNS = 100;

/** Símbolo usado pelo winston para armazenar a mensagem renderizada do registro. */
const MESSAGE = Symbol.for('message') as unknown as string;

/** Padrões de contexto de tracing válido do OpenTelemetry (hex não-zero). */
const VALID_TRACE_ID = /^[0-9a-f]{32}$/;
const VALID_SPAN_ID = /^[0-9a-f]{16}$/;
const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';

/**
 * Transporte winston in-memory: captura o registro renderizado por cada emissão
 * que chega ao transporte. O JSON final do logger fica em `info[Symbol.for('message')]`.
 */
class MemoryTransport extends Transport {
  public readonly rendered: string[] = [];

  log(info: winston.Logform.TransformableInfo, callback: () => void): void {
    const payload = (info as Record<string | symbol, unknown>)[MESSAGE];
    this.rendered.push(typeof payload === 'string' ? payload : JSON.stringify(info));
    callback();
  }
}

/** Gerador de mensagem de log arbitrária (não vazia). */
const messageArb = fc.string({ minLength: 1, maxLength: 120 });

/** Gerador de nome de operação de Span válido (1..255 chars). */
const spanNameArb = fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.length >= 1);

describe('Property 9: Campos de tracing condicionados ao Span ativo', () => {
  let sdkProvider: BasicTracerProvider;
  let contextManager: AsyncLocalStorageContextManager;
  let logger: LoggerService;
  let memory: MemoryTransport;
  let previousLogFormat: string | undefined;

  beforeAll(() => {
    // Força o formato JSON para que o formato combinado (com otelFormat) seja o
    // aplicado ao transporte, produzindo o JSON em Symbol.for('message').
    previousLogFormat = process.env.LOG_FORMAT;
    process.env.LOG_FORMAT = 'json';

    // SDK em memória: produz Spans gravadores com spanContext() válido.
    const exporter = new InMemorySpanExporter();
    sdkProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    // Gerenciador de contexto: habilita a propagação do Span ativo para
    // trace.getActiveSpan() dentro de startActiveSpan.
    contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();

    trace.setGlobalTracerProvider(sdkProvider);
    context.setGlobalContextManager(contextManager);

    // Logger no nível mais permissivo (verbose) para não filtrar as emissões.
    logger = new LoggerService('TracingFieldsTest', 'verbose', 'test', 'tracing-fields-test');

    // Anexa o transporte in-memory, que recebe o registro já renderizado pelo
    // formato combinado do logger (otelFormat + contexto + timestamp + json).
    memory = new MemoryTransport({ level: 'verbose' });
    logger.add(memory);
  });

  afterAll(async () => {
    logger?.remove(memory);
    logger?.close();
    contextManager.disable();
    context.disable();
    trace.disable();
    await sdkProvider.shutdown();
    if (previousLogFormat === undefined) {
      delete process.env.LOG_FORMAT;
    } else {
      process.env.LOG_FORMAT = previousLogFormat;
    }
  });

  /** Emite uma mensagem e retorna o último registro renderizado como objeto. */
  function emitAndParse(message: string): Record<string, unknown> {
    const before = memory.rendered.length;
    logger.info(message);
    expect(memory.rendered.length).toBeGreaterThan(before);
    const raw = memory.rendered[memory.rendered.length - 1];
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it('inclui traceId/spanId (válidos) quando há um Span ativo no momento da emissão', () => {
    fc.assert(
      fc.property(spanNameArb, messageArb, (spanName, message) => {
        const tracer = trace.getTracer('tracing-fields-test');
        tracer.startActiveSpan(spanName, (span: Span) => {
          try {
            const record = emitAndParse(message);
            const active = span.spanContext();

            // (R3.1) Presentes e correspondentes ao Span ativo.
            expect(record.traceId).toBe(active.traceId);
            expect(record.spanId).toBe(active.spanId);
            // Contexto válido (span gravador do SDK), não no-op.
            expect(String(record.traceId)).toMatch(VALID_TRACE_ID);
            expect(String(record.spanId)).toMatch(VALID_SPAN_ID);
            expect(record.traceId).not.toBe(ZERO_TRACE_ID);
            expect(record.spanId).not.toBe(ZERO_SPAN_ID);
          } finally {
            span.end();
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('omite traceId/spanId quando NÃO há Span ativo no momento da emissão', () => {
    fc.assert(
      fc.property(messageArb, (message) => {
        // Fora de qualquer startActiveSpan: trace.getActiveSpan() é undefined.
        expect(trace.getActiveSpan()).toBeUndefined();

        const record = emitAndParse(message);

        // (R3.2) Ausentes quando não há Span ativo.
        expect(record.traceId).toBeUndefined();
        expect(record.spanId).toBeUndefined();
        expect('traceId' in record).toBe(false);
        expect('spanId' in record).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a presença de traceId/spanId equivale (sse) à existência de um Span ativo', () => {
    fc.assert(
      fc.property(spanNameArb, messageArb, fc.boolean(), (spanName, message, withSpan) => {
        if (withSpan) {
          const tracer = trace.getTracer('tracing-fields-test');
          tracer.startActiveSpan(spanName, (span: Span) => {
            try {
              const record = emitAndParse(message);
              const hasFields = 'traceId' in record && 'spanId' in record;
              expect(hasFields).toBe(true);
            } finally {
              span.end();
            }
          });
        } else {
          const record = emitAndParse(message);
          const hasFields = 'traceId' in record && 'spanId' in record;
          expect(hasFields).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

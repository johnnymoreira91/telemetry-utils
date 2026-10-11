/**
 * Teste de propriedade — semântica de sucesso e erro de `withTrace`.
 *
 * Feature: telemetry-utils, Property 10: Semântica de sucesso e erro de withTrace
 *
 * Para qualquer função assíncrona executada por `withTrace`, se a função
 * resolve, o span é encerrado e o valor resolvido é retornado ao chamador; se a
 * função lança, a mesma exceção é repropagada, o span é marcado com status de
 * erro e encerrado.
 *
 * Validates: Requirements 3.3, 3.4
 *
 * NOTA DE INFRAESTRUTURA DE TESTE:
 * O `@opentelemetry/api` isolado (sem um SDK/TracerProvider registrado) retorna
 * Spans no-op não gravadores, que não são exportados nem acumulam status. Para
 * observar o encerramento do span, o status de erro e o evento de exceção, este
 * teste registra um TracerProvider em memória (`BasicTracerProvider` +
 * `InMemorySpanExporter` via `SimpleSpanProcessor`) e um
 * `AsyncLocalStorageContextManager` como gerenciador de contexto global — este
 * último permite que `startActiveSpan` (usado internamente por `withTrace`)
 * propague o Span ativo. Apenas spans encerrados (`span.end()`) são entregues ao
 * `InMemorySpanExporter.getFinishedSpans()`, de modo que a presença de um span
 * exportado comprova que ele foi encerrado.
 */

import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import * as fc from 'fast-check';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LoggerService } from './logger-service';

const NUM_RUNS = 100;

/** Serviço usado para obter o tracer nomeado dentro de `withTrace`. */
const SERVICE = 'withtrace-test';

/** Gerador de nome de operação válido (1..255 chars). */
const spanNameArb = fc.string({ minLength: 1, maxLength: 255 });

/** Gerador de valores arbitrários que uma função pode resolver. */
const resolvedValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.object(),
  fc.array(fc.anything()),
);

/** Gerador de mensagens de erro. */
const errorMessageArb = fc.string({ minLength: 1, maxLength: 120 });

describe('Property 10: Semântica de sucesso e erro de withTrace', () => {
  let sdkProvider: BasicTracerProvider;
  let contextManager: AsyncLocalStorageContextManager;
  let exporter: InMemorySpanExporter;
  let logger: LoggerService;

  beforeAll(() => {
    // SDK em memória: produz spans gravadores que acumulam status/eventos e são
    // exportados ao serem encerrados.
    exporter = new InMemorySpanExporter();
    sdkProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    // Gerenciador de contexto: habilita a propagação do Span ativo em
    // startActiveSpan (usado por withTrace).
    contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();

    trace.setGlobalTracerProvider(sdkProvider);
    context.setGlobalContextManager(contextManager);

    // O construtor do LoggerService chama loadConfig(); o serviço fixo garante
    // que trace.getTracer(this.service) resolva o provider em memória.
    logger = new LoggerService('WithTraceTest', 'info', 'test', SERVICE);
  });

  afterEach(() => {
    // Reseta o exporter entre execuções para inspecionar spans isoladamente.
    exporter.reset();
  });

  afterAll(async () => {
    contextManager.disable();
    context.disable();
    trace.disable();
    await sdkProvider.shutdown();
  });

  it('caso de sucesso: retorna o valor resolvido e encerra o span sem status de erro', async () => {
    await fc.assert(
      fc.asyncProperty(spanNameArb, resolvedValueArb, async (name, value) => {
        exporter.reset();

        const returned = await logger.withTrace(name, async () => value);

        // (R3.3) O valor resolvido pela função é retornado ao chamador.
        expect(returned).toStrictEqual(value);

        // (R3.3) O span foi encerrado: só spans encerrados chegam ao exporter.
        const finished = exporter.getFinishedSpans();
        const span = finished.find((s: ReadableSpan) => s.name === name);
        expect(span).toBeDefined();

        // Sucesso não marca status de erro.
        expect(span!.status.code).not.toBe(SpanStatusCode.ERROR);
        // Sucesso não registra evento de exceção.
        const hasException = span!.events.some((e) => e.name === 'exception');
        expect(hasException).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('caso de erro: repropaga a mesma exceção, marca status de erro e encerra o span registrando a exceção', async () => {
    await fc.assert(
      fc.asyncProperty(spanNameArb, errorMessageArb, async (name, message) => {
        exporter.reset();

        const thrown = new Error(message);

        let caught: unknown;
        try {
          await logger.withTrace(name, async () => {
            throw thrown;
          });
          // Não deve alcançar aqui: a exceção deve ser repropagada.
          expect.unreachable('withTrace deveria repropagar a exceção');
        } catch (error) {
          caught = error;
        }

        // (R3.4) A mesma exceção é repropagada ao chamador.
        expect(caught).toBe(thrown);

        // (R3.4) O span foi encerrado: presente nos spans exportados.
        const finished = exporter.getFinishedSpans();
        const span = finished.find((s: ReadableSpan) => s.name === name);
        expect(span).toBeDefined();

        // (R3.4) O status do span é ERROR (SpanStatusCode.ERROR === 2).
        expect(span!.status.code).toBe(SpanStatusCode.ERROR);

        // (R3.4) A exceção foi registrada como evento de exceção.
        const exceptionEvent = span!.events.find((e) => e.name === 'exception');
        expect(exceptionEvent).toBeDefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

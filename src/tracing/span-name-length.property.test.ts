/**
 * Teste de propriedade — validação do comprimento do nome do Span.
 *
 * Feature: telemetry-utils, Property 17: Validação do comprimento do nome do Span
 *
 * Para qualquer string de nome de operação, a criação do Span é aceita quando o
 * comprimento está entre 1 e 255 caracteres (inclusive) e rejeitada quando o
 * comprimento é 0 ou superior a 255.
 *
 * Na ausência de um SDK OpenTelemetry configurado, `@opentelemetry/api` retorna
 * um no-op span, o que é suficiente para validar a aceitação/rejeição pela
 * lógica de validação de comprimento do TracerProvider.
 *
 * Validates: Requirements 5.1
 */

import type { Span } from '@opentelemetry/api';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TracerProvider } from './tracer-provider';
import type { TelemetryConfig } from '../types';

const NUM_RUNS = 100;

/** Limites de comprimento válidos para o nome de uma operação/Span (R5.1). */
const MIN_SPAN_NAME_LENGTH = 1;
const MAX_SPAN_NAME_LENGTH = 255;

/**
 * Monta uma `TelemetryConfig` mínima suficiente para instanciar o
 * `TracerProvider`. Apenas `applicationName` é relevante para a obtenção do
 * tracer; os demais campos recebem valores fixos.
 */
function makeConfig(): TelemetryConfig {
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
      traces: 'http://collector.local:4318/v1/traces',
      logs: 'http://collector.local:4318/v1/logs',
      metrics: 'http://collector.local:4318/v1/metrics',
    },
    exportTargets: {
      traces: 'otlp',
      metrics: 'otlp',
    },
  };
}

/**
 * Encerra o Span retornado de forma segura; o no-op span expõe `end()` sem
 * efeitos colaterais quando não há SDK configurado.
 */
function endSpan(span: Span): void {
  expect(span).toBeDefined();
  expect(typeof span.end).toBe('function');
  span.end();
}

describe('Property 17: Validação do comprimento do nome do Span', () => {
  const provider = new TracerProvider(makeConfig());

  it('aceita nomes com comprimento entre 1 e 255 (inclusive) e retorna um Span', () => {
    fc.assert(
      fc.property(
        // Gera strings cujo comprimento está estritamente no intervalo [1, 255].
        fc.string({ minLength: MIN_SPAN_NAME_LENGTH, maxLength: MAX_SPAN_NAME_LENGTH }),
        (name) => {
          fc.pre(
            name.length >= MIN_SPAN_NAME_LENGTH && name.length <= MAX_SPAN_NAME_LENGTH,
          );

          let span: Span | undefined;
          expect(() => {
            span = provider.startSpan(name);
          }).not.toThrow();

          expect(span).toBeDefined();
          endSpan(span as Span);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('aceita os limites exatos de 1 e 255 caracteres', () => {
    for (const length of [MIN_SPAN_NAME_LENGTH, MAX_SPAN_NAME_LENGTH]) {
      const name = 'a'.repeat(length);
      let span: Span | undefined;
      expect(() => {
        span = provider.startSpan(name);
      }).not.toThrow();
      expect(span).toBeDefined();
      endSpan(span as Span);
    }
  });

  it('rejeita o nome vazio (comprimento 0) com erro identificando o comprimento inválido', () => {
    expect(() => provider.startSpan('')).toThrowError(/0/);
  });

  it('rejeita nomes com comprimento superior a 255 com erro identificando o comprimento inválido', () => {
    fc.assert(
      fc.property(
        // Gera strings cujo comprimento é estritamente maior que 255.
        fc.string({ minLength: MAX_SPAN_NAME_LENGTH + 1, maxLength: 1024 }),
        (name) => {
          fc.pre(name.length > MAX_SPAN_NAME_LENGTH);

          expect(() => provider.startSpan(name)).toThrowError(
            new RegExp(String(name.length)),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

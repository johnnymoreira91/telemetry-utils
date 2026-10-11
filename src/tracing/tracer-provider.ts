/**
 * Tracer_Provider (`src/tracing/tracer-provider.ts`) — R5.
 *
 * Encapsula a API de tracing do OpenTelemetry (`@opentelemetry/api`), expondo
 * uma interface para criar Spans associados a operações nomeadas. O tracer é
 * obtido via `trace.getTracer(config.applicationName)`; os exportadores e os
 * atributos de recurso (`service.name`/`APP_STAGE`) são configurados pelo
 * bootstrap do Node_SDK (R5.2, R5.3).
 *
 * Comportamentos:
 * - `startSpan(name, options)`: valida o comprimento do nome (1..255) ANTES de
 *   criar o Span, rejeitando com erro descritivo quando inválido (R5.1). Na
 *   ausência de um Span ativo, o Span é criado como raiz de um novo
 *   Trace_Context (R5.4).
 * - `startActiveSpan(name, fn)`: delega ao `startActiveSpan` do tracer, que
 *   torna o Span o ativo no contexto corrente — vinculando-o automaticamente
 *   ao Trace_Context do pai quando houver (R5.4).
 */

import {
  type Span,
  type SpanOptions,
  type Tracer,
  trace,
} from '@opentelemetry/api';

import type { TelemetryConfig } from '../types';

/** Comprimento mínimo permitido para o nome de uma operação/Span (R5.1). */
const MIN_SPAN_NAME_LENGTH = 1;

/** Comprimento máximo permitido para o nome de uma operação/Span (R5.1). */
const MAX_SPAN_NAME_LENGTH = 255;

/**
 * Provedor de tracing da Telemetry_Library.
 *
 * Cria e expõe Spans para operações nomeadas, delegando a propagação de
 * contexto pai/filho ao mecanismo de contexto ativo do OpenTelemetry.
 */
export class TracerProvider {
  /** Tracer do OpenTelemetry nomeado conforme a aplicação (`APPLICATION_NAME`). */
  private readonly tracer: Tracer;

  /**
   * @param config Configuração de telemetria resolvida; `applicationName` é
   *   usado para obter o tracer nomeado via `trace.getTracer` (R5.3).
   */
  constructor(config: TelemetryConfig) {
    this.tracer = trace.getTracer(config.applicationName);
  }

  /**
   * Valida o comprimento do nome de uma operação/Span (R5.1).
   *
   * @param name Nome da operação a validar.
   * @throws {Error} Quando o comprimento é 0 ou superior a 255, com mensagem
   *   descritiva identificando o comprimento inválido informado.
   */
  private static validateSpanName(name: string): void {
    if (name.length < MIN_SPAN_NAME_LENGTH || name.length > MAX_SPAN_NAME_LENGTH) {
      throw new Error(
        `[telemetry-utils] Nome de span invalido: comprimento ${name.length}. ` +
          `Esperado entre ${MIN_SPAN_NAME_LENGTH} e ${MAX_SPAN_NAME_LENGTH} caracteres (inclusive).`,
      );
    }
  }

  /**
   * Cria um Span nomeado associado a uma operação (R5.1, R5.4).
   *
   * O comprimento do nome é validado ANTES da criação do Span: nomes com 0 ou
   * mais de 255 caracteres são rejeitados com erro descritivo. Na ausência de
   * um Span ativo no contexto corrente, o Span resultante é a raiz de um novo
   * Trace_Context; havendo Span ativo, o OpenTelemetry o vincula ao
   * Trace_Context do pai automaticamente.
   *
   * @param name Nome da operação (1..255 caracteres).
   * @param options Opções do Span repassadas ao tracer do OpenTelemetry.
   * @returns O Span criado.
   * @throws {Error} Quando o comprimento do nome é inválido (R5.1).
   */
  startSpan(name: string, options?: SpanOptions): Span {
    TracerProvider.validateSpanName(name);
    return this.tracer.startSpan(name, options);
  }

  /**
   * Cria um Span ativo e executa `fn` dentro do seu contexto (R5.4).
   *
   * Delega ao `startActiveSpan` do tracer, que torna o Span o ativo no contexto
   * corrente durante a execução de `fn`. Quando já existe um Span ativo, o novo
   * Span é vinculado ao Trace_Context do pai; caso contrário, torna-se a raiz
   * de um novo Trace_Context. O comprimento do nome é validado antes da criação.
   *
   * @typeParam T Tipo de retorno de `fn`.
   * @param name Nome da operação (1..255 caracteres).
   * @param fn Função executada recebendo o Span ativo; seu retorno é propagado.
   * @returns O valor retornado por `fn`.
   * @throws {Error} Quando o comprimento do nome é inválido (R5.1).
   */
  startActiveSpan<T>(name: string, fn: (span: Span) => T): T {
    TracerProvider.validateSpanName(name);
    return this.tracer.startActiveSpan(name, fn);
  }
}

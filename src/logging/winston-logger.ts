/**
 * WinstonLogger (`src/logging/winston-logger.ts`) — R1.
 *
 * Reproduz fielmente a classe de referência (`@engebras/lib-logger`): define os
 * níveis de log customizados e suas prioridades numéricas (R1.1), as cores por
 * nível (R1.2) e os utilitários de formatação de contexto/impressão usados pelo
 * console estilizado (R1.4). A classe estende `winston.Logger`, servindo de base
 * para o `LoggerService` (que adiciona transportes, formatos combinados e a
 * integração com tracing/Namespace).
 *
 * O estilo de console é implementado com códigos ANSI auto-contidos (sem
 * dependência externa de biblioteca de cores), mapeando os nomes de estilo
 * descritos na tabela de design (ex.: `bold italic dim red`).
 */

import * as winston from 'winston';
import type { AbstractConfigSetColors, AbstractConfigSetLevels } from 'winston/lib/winston/config';

import namespace from './namespace';

/**
 * Nomes de estilo/cor ANSI reconhecidos por `styled`. Cobrem os modificadores
 * (`bold`, `italic`, `dim`) e as cores de primeiro plano usadas na tabela de
 * cores por nível (R1.2).
 */
const ANSI_CODES: Record<string, number> = {
  // modificadores
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  // cores de primeiro plano
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  grey: 90,
};

/** Sequência ANSI de reset aplicada ao final de cada trecho estilizado. */
const ANSI_RESET = '\u001b[0m';

/**
 * Mapa de cores por nível de log (R1.2), conforme a tabela de design
 * (Data Models — níveis de log). Cada valor é uma composição de estilos ANSI
 * separados por espaço, no mesmo formato aceito pelo colorizer do winston.
 */
const logColors = {
  crit: 'bold italic dim red',
  alert: 'bold cyan',
  http: 'bold blue',
  error: 'bold red',
  warn: 'yellow',
  info: 'green',
  debug: 'magenta',
  verbose: 'bold italic dim',
} as const;

/**
 * Classe base do Logger que preserva o comportamento da biblioteca de
 * referência: níveis/cores customizados e utilitários de formatação (R1).
 */
export class WinstonLogger extends winston.Logger {
  /**
   * Níveis de log com prioridade numérica fixa (R1.1), do mais crítico
   * (`crit`=0) ao menos crítico (`verbose`=7). Semântica de filtragem: um
   * registro é emitido quando `prioridade(nível_registro) <= prioridade(LOG_LEVEL)`.
   */
  static levels: AbstractConfigSetLevels = {
    crit: 0,
    alert: 1,
    http: 2,
    error: 3,
    warn: 4,
    info: 5,
    debug: 6,
    verbose: 7,
  };

  /**
   * Cores de exibição associadas a cada nível de log (R1.2), conforme a tabela
   * de design. Registradas no winston via `winston.addColors`.
   */
  static colors: AbstractConfigSetColors = { ...logColors };

  /**
   * Converte um rótulo de contexto para PascalCase (R1.4).
   *
   * Divide o rótulo por separadores comuns (espaço, hífen, underscore, ponto),
   * capitaliza a inicial de cada segmento e concatena sem separadores.
   *
   * @param label Rótulo de contexto bruto (pode ser `undefined`).
   * @returns O rótulo em PascalCase, ou `undefined` quando ausente/vazio.
   */
  static parsePascalCase(label?: string): string | undefined {
    if (label === undefined || label === null) {
      return undefined;
    }

    const segments = label
      .split(/[\s\-_.]+/)
      .filter((segment) => segment.length > 0);

    if (segments.length === 0) {
      return undefined;
    }

    return segments.map((segment) => WinstonLogger.ucFirst(segment)).join('');
  }

  /**
   * Concatena a mensagem com a representação textual dos dados associados
   * (R1.4). Dados `undefined`/`null` resultam na mensagem inalterada; demais
   * valores são serializados em JSON e anexados após a mensagem.
   *
   * @param message Mensagem base do registro.
   * @param data Dados adicionais a serem anexados à mensagem.
   * @returns A mensagem possivelmente concatenada com os dados serializados.
   */
  static concatMessageWithDataString(message: string, data: unknown): string {
    if (data === undefined || data === null) {
      return message;
    }

    let dataString: string;
    try {
      dataString = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
      // Fallback resiliente para estruturas não serializáveis (ex.: referências circulares).
      dataString = String(data);
    }

    if (dataString === undefined || dataString === '') {
      return message;
    }

    return `${message} ${dataString}`;
  }

  /**
   * Normaliza dados variádicos (array) para um objeto indexado por posição
   * (R1.4). Entradas vazias/ausentes resultam em objeto vazio; um único
   * elemento objeto é retornado como está, preservando sua forma.
   *
   * @param data Array de dados adicionais (pode ser `null`/`undefined`).
   * @returns Um objeto com os dados; vazio quando não há dados.
   */
  static transformArrayDataToObject(data?: null | unknown[]): object {
    if (data === undefined || data === null || data.length === 0) {
      return {};
    }

    if (data.length === 1) {
      const [only] = data;
      if (only !== null && typeof only === 'object' && !Array.isArray(only)) {
        return only as object;
      }
      return { data: only };
    }

    return { ...data };
  }

  /**
   * Capitaliza a primeira letra de um rótulo, preservando o restante (R1.4).
   *
   * @param label Rótulo a capitalizar.
   * @returns O rótulo com a inicial em caixa alta.
   */
  static ucFirst(label: string): string {
    if (!label) {
      return label;
    }
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  /**
   * Aplica estilização ANSI a uma mensagem conforme a cor/estilo informado
   * (R1.2, R1.4). O `color` é uma chave da tabela de cores por nível, cujo
   * valor pode compor múltiplos estilos separados por espaço (ex.:
   * `bold italic dim red`). Estilos desconhecidos são ignorados silenciosamente.
   *
   * @param color Chave de cor/estilo (nível de log) da tabela `logColors`.
   * @param message Texto a ser estilizado.
   * @returns A mensagem envolvida pelas sequências ANSI correspondentes.
   */
  static styled(color: keyof typeof logColors, message: string): string {
    const styleSpec = logColors[color];
    if (!styleSpec) {
      return message;
    }

    const codes = styleSpec
      .split(/\s+/)
      .map((name) => ANSI_CODES[name])
      .filter((code): code is number => typeof code === 'number');

    if (codes.length === 0) {
      return message;
    }

    const prefix = codes.map((code) => `\u001b[${code}m`).join('');
    return `${prefix}${message}${ANSI_RESET}`;
  }

  /**
   * Formato winston que injeta os campos de correlação do Namespace ativo no
   * registro (R2.4/R2.5). Quando há escopo ativo, adiciona `correlationId`
   * (Correlation_Id) e `keyId`; na ausência de escopo, o registro segue sem
   * esses campos.
   */
  static formatContext: winston.Logform.FormatWrap = winston.format((info) => {
    const correlationId = namespace.getRequestId<string>();
    const keyId = namespace.getkeyId<string>();

    if (correlationId !== undefined && correlationId !== null) {
      info.correlationId = correlationId;
    }
    if (keyId !== undefined && keyId !== null) {
      info.keyId = keyId;
    }

    return info;
  });

  /**
   * Formato winston de impressão estilizada no console (R1.4).
   *
   * Compõe uma linha com:
   * - prefixo `[stage-service]` (service derivado do `defaultMeta`/`info.service`);
   * - timestamp e nível (nível colorido conforme a tabela de cores);
   * - contexto em PascalCase (quando presente);
   * - Correlation_Id truncado nos últimos 7 caracteres quando possuir mais de 7,
   *   ou integral quando possuir 7 caracteres ou menos (R1.4);
   * - a mensagem (concatenada com dados adicionais quando houver).
   *
   * @param stage Estágio da aplicação usado no prefixo `[stage-service]`.
   * @returns Um `winston.Logform.Format` que produz a linha estilizada.
   */
  static formatPrint(stage: string): winston.Logform.Format {
    return winston.format.printf((info: winston.Logform.TransformableInfo) => {
      const level = String(info.level);
      const service = info.service === undefined ? '' : String(info.service);
      const timestamp = info.timestamp === undefined ? '' : String(info.timestamp);
      const message = info.message === undefined ? '' : String(info.message);

      const prefix = `[${stage}-${service}]`;

      const context = WinstonLogger.parsePascalCase(
        info.context === undefined ? undefined : String(info.context),
      );

      const correlationId =
        info.correlationId === undefined || info.correlationId === null
          ? undefined
          : String(info.correlationId);

      const truncatedCorrelationId =
        correlationId === undefined
          ? undefined
          : correlationId.length > 7
            ? correlationId.slice(-7)
            : correlationId;

      const coloredLevel = WinstonLogger.styled(level as keyof typeof logColors, level);

      const parts: string[] = [prefix];
      if (timestamp) {
        parts.push(timestamp);
      }
      parts.push(coloredLevel);
      if (context) {
        parts.push(`[${context}]`);
      }
      if (truncatedCorrelationId !== undefined) {
        parts.push(`(${truncatedCorrelationId})`);
      }
      parts.push(message);

      return parts.join(' ');
    });
  }

  /**
   * @param options Opções do logger winston (níveis, formato, transportes).
   */
  constructor(options: winston.LoggerOptions) {
    super(options);
  }
}

// Registra as cores customizadas por nível no winston (R1.2).
winston.addColors(WinstonLogger.colors);

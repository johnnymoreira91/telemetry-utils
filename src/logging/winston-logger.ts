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
   * Comprimento de coluna para alinhar o nível (maior rótulo é `verbose`,
   * 7 caracteres). O nível é exibido em MAIÚSCULAS e preenchido à direita.
   */
  private static readonly LEVEL_COLUMN_WIDTH = 7;

  /**
   * Formata o timestamp no padrão `DD/MM/YYYY HH:mm:ss`.
   *
   * Aceita um timestamp ISO (ou qualquer valor parseável por `Date`); quando
   * não parseável, retorna a string original. Timestamp ausente retorna vazio.
   *
   * @param raw Valor bruto de `info.timestamp`.
   * @returns A data/hora formatada em pt-BR, ou a string original/vazia.
   */
  private static formatTimestamp(raw: unknown): string {
    if (raw === undefined || raw === null || raw === '') {
      return '';
    }
    const text = String(raw);
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return text;
    }
    const pad = (n: number): string => String(n).padStart(2, '0');
    const dd = pad(date.getDate());
    const mm = pad(date.getMonth() + 1);
    const yyyy = date.getFullYear();
    const hh = pad(date.getHours());
    const mi = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
  }

  /**
   * Formato winston de impressão estilizada no console (R1.4), no estilo de
   * referência (NestJS-like):
   *
   *   `[service] <pid>  - DD/MM/YYYY HH:mm:ss   NIVEL [Context] (correlationId) mensagem`
   *
   * - prefixo `[service]` colorido (service derivado do `defaultMeta`/`info.service`);
   * - PID do processo (`info.pid` quando presente, senão `process.pid`);
   * - data/hora no formato `DD/MM/YYYY HH:mm:ss`;
   * - nível em MAIÚSCULAS, alinhado em coluna e colorido conforme a tabela de cores;
   * - contexto em PascalCase (quando presente), colorido;
   * - Correlation_Id truncado nos últimos 7 caracteres quando possuir mais de 7,
   *   ou integral quando possuir 7 caracteres ou menos (R1.4);
   * - a mensagem (concatenada com dados adicionais quando houver).
   *
   * O parâmetro `stage` é mantido na assinatura por compatibilidade; o prefixo
   * passou a usar apenas `[service]` conforme o formato de referência.
   *
   * @param stage Estágio da aplicação (mantido por compatibilidade de assinatura).
   * @returns Um `winston.Logform.Format` que produz a linha estilizada.
   */
  static formatPrint(stage: string): winston.Logform.Format {
    void stage; // mantido por compatibilidade; o prefixo usa apenas [service].
    return winston.format.printf((info: winston.Logform.TransformableInfo) => {
      const level = String(info.level);
      const service = info.service === undefined ? '' : String(info.service);
      const message = info.message === undefined ? '' : String(info.message);

      const pid = info.pid === undefined || info.pid === null ? process.pid : info.pid;
      const timestamp = WinstonLogger.formatTimestamp(info.timestamp);

      // Prefixo [service] colorido (verde, como no formato de referência).
      const prefix = WinstonLogger.styled('info', `[${service}]`);

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

      // Nível em MAIÚSCULAS, alinhado em coluna e colorido pela tabela.
      const levelLabel = level.toUpperCase().padEnd(WinstonLogger.LEVEL_COLUMN_WIDTH, ' ');
      const coloredLevel = WinstonLogger.styled(level as keyof typeof logColors, levelLabel);

      const parts: string[] = [prefix, String(pid), '-', timestamp, ' ', coloredLevel];
      if (context) {
        parts.push(WinstonLogger.styled('info', `[${context}]`));
      }
      if (truncatedCorrelationId !== undefined) {
        parts.push(`(${truncatedCorrelationId})`);
      }
      parts.push(message);

      return parts.filter((part) => part !== '').join(' ');
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

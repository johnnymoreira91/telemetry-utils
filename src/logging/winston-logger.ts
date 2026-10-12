import { inspect } from 'node:util';
import namespace from './namespace';
import * as winston from 'winston';
import type { AbstractConfigSetColors, AbstractConfigSetLevels } from 'winston/lib/winston/config';

export const logColors = {
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  gray: '\x1b[37m'
};

export class WinstonLogger extends winston.Logger {
  static levels: AbstractConfigSetLevels = {
    crit: 0, // alertar um erro critico no sistema, raramente usado
    alert: 1, // será usado quando o reenvio for feito ou por algum incosistencia no banco que deverá gerar alertas
    http: 2, // logar o retorno de uma requisição http
    error: 3, // erro que não impede o funcionamento do sistema
    warn: 4, // alerta de algo que não está certo, mas não impede o funcionamento do sistema
    info: 5, // informações sobre o funcionamento do sistema
    debug: 6, // informações para debugar o sistema
    verbose: 7 // informações detalhadas para depurar o sistema
  };

  static colors: AbstractConfigSetColors = {
    crit: 'bold italic dim red',
    alert: 'bold cyan',
    http: 'bold blue',
    error: 'bold red',
    warn: 'yellow',
    info: 'green',
    debug: 'magenta',
    verbose: 'bold italic dim'
  };

  static parsePascalCase = (label?: string) => {
    return label
      ? label
        .replace(/[_\-\s]+/g, ' ')
        .replace(/(^\w|\b\w)/g, (match) => match.toUpperCase())
        .replace(/\s+/g, '')
      : undefined;
  };

  constructor(options: winston.LoggerOptions) {
    super(options);
  }

  static concatMessageWithDataString = (message: string, data: any) => {
    const dataMessage = [message];
    for (const key in data) {
      if (!Array.isArray(data[key]) && !(data[key] instanceof Object) && dataMessage.indexOf(data[key]) === -1) {
        dataMessage.push(data[key]);
      }
    }
    return dataMessage.join(' | ');
  };

  static transformArrayDataToObject = (data?: null | any[]) =>
    data?.reduce((acc, item: any) => {
      if (Array.isArray(item) || (item instanceof Object)) {
        acc = item;
      }
      return acc;
    }, {}) || {};

  static formatContext = winston.format(({ [Symbol.for('splat')]: splat, ...info }, opts: any) => {
    if (namespace.isActived()) {
      info.correlationId = namespace.getRequestId<string>();
      info.keyId = namespace.getkeyId<string>();
    }
    if (info.context) {
      info.message = `(${info.context}) ${info.message}`;
    }
    if (splat) {
      info.message = this.concatMessageWithDataString(info.message as any, splat as any);
      info = {
        ...info,
        ...this.transformArrayDataToObject(splat as any)
      };
    }

    info.level = (info.level as string).toUpperCase().padStart(opts?.pad || 0);
    return info;
  });

  static ucFirst = (label: string) => {
    return label && typeof label === 'string' ? label.charAt(0).toUpperCase() + label.slice(1) : '';
  };

  static formatPrint(stage: string) {
    return winston.format.printf(
      ({ correlationId, [Symbol.for('level')]: level, ...info }) => {
        const puid = String(correlationId || process.pid).slice(-7).padEnd(7, ' ');
        const appPrefix = `[${this.parsePascalCase(stage + '-' + info.service)}]`;
        let message = `\x1b[33m${appPrefix} ${puid}\x1b[0m - ${info.timestamp} ${info.level} ${info.message}`;

        if (['crit', 'error', 'debug'].includes(level as any) && Object.keys((info.data as any) || {})?.length > 0) {
          message += '\x1b[0m ' + inspect(info.data, { depth: 4, colors: true, maxStringLength: 100 });
        }
        return message;
      }
    );
  }

  static styled(color: keyof typeof logColors, message: string) {
    return `${logColors[color]}${message}\x1b[0m`;
  }

  static ExtendsNestLogger(controllerName = 'NestFactory') {
    function getNestLoggerProps(ctx: any[]) {
      const control = ctx[ctx.length - 1] || controllerName;
      const context = ctx.slice(0, ctx.length - 1).filter((item) => item);
      return { control, context };
    }

    return {
      verbose: (message: any, ...ctx: any[]): any => {
        const { context, control } = getNestLoggerProps(ctx);
        new (this as any)(control).verbose(message, ...context);
      },
      debug: (message: any, ...ctx: any[]): any => {
        const { context, control } = getNestLoggerProps(ctx);
        new (this as any)(control).debug(message, ...context);
      },
      log: (message: any, ...ctx: any[]): any => {
        const { context, control } = getNestLoggerProps(ctx);
        new (this as any)(control).info(message, ...context);
      },
      warn: (message: any, ...ctx: any[]): any => {
        const { context, control } = getNestLoggerProps(ctx);
        new (this as any)(control).warn(message, ...context);
      },
      error: (message: any, ...ctx: any[]): any => {
        const { context, control } = getNestLoggerProps(ctx);
        if (message instanceof Error)
          new (this as any)(control).error(message?.message || 'Error', { error: message }, ...context);
        else
          new (this as any)(control).error(message, ...context);
      },
      fatal: (message: any, ...ctx: any[]): any => {
        const { context, control } = getNestLoggerProps(ctx);
        if (message instanceof Error)
          new (this as any)(control).crit(message?.message || 'Error', { error: message }, ...context);
        else
          new (this as any)(control).crit(message, ...context);
      },
    };
  }
}

winston.addColors(WinstonLogger.colors);

// Anexa os atalhos por nivel (info/error/crit/...) ao prototipo do
// WinstonLogger, reproduzindo o comportamento de winston.createLogger (que
// define esses metodos num prototipo derivado). Como estendemos winston.Logger
// diretamente e NAO retornamos um createLogger no construtor, precisamos
// declara-los para que logger.info(...), logger.crit(...), etc. existam.
for (const level of Object.keys(WinstonLogger.levels)) {
  if (level === 'log') continue;
  (WinstonLogger.prototype as unknown as Record<string, unknown>)[level] = function (
    this: WinstonLogger,
    ...args: unknown[]
  ) {
    return (this.log as (...a: unknown[]) => unknown)(level, ...args);
  };
}


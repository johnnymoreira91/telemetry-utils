import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'tracing/index': 'src/tracing/index.ts',
  },
  format: ['cjs'],
  target: 'node20',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: true,
  external: [
    'winston',
    'winston-loki',
    '@opentelemetry/api',
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/instrumentation-runtime-node',
    '@opentelemetry/winston-transport',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/exporter-logs-otlp-http',
    '@opentelemetry/exporter-metrics-otlp-http',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/resources',
    '@opentelemetry/resource-detector-aws',
    'dotenv',
  ],
});

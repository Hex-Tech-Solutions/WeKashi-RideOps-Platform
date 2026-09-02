import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

// pino-pretty is a devDependency, so it is absent from any image built with
// `npm prune --production`. Only use it if it's actually installed: a
// container running with NODE_ENV=development (the dev/test stack does) would
// otherwise crash on boot with "unable to determine transport target for
// pino-pretty" — a log formatter should never stop the app from starting.
function prettyTransport() {
  if (process.env.NODE_ENV === 'production') return undefined;
  try {
    require.resolve('pino-pretty');
  } catch {
    return undefined; // not installed — fall back to plain JSON logs
  }
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

export const logger = pino({
  level,
  transport: prettyTransport(),
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

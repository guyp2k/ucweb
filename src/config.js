import path from 'node:path';

export function loadConfig(env) {
  const remotes = (env.UC_REMOTES ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (remotes.length === 0) {
    throw new Error('UC_REMOTES must list at least one remote address, for example UC_REMOTES=192.168.1.20,192.168.1.21');
  }
  for (const address of remotes) {
    if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(address)) {
      throw new Error(`UC_REMOTES contains "${address}", which is not a host name or IP address (with an optional :port).`);
    }
  }
  if (new Set(remotes).size !== remotes.length) {
    throw new Error('UC_REMOTES lists the same remote more than once.');
  }

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535, got "${env.PORT}".`);
  }

  const configDir = env.UCWEB_CONFIG_DIR || '/config';
  return {
    remotes,
    port,
    configDir,
    keysDir: env.UC_KEYS_DIR || path.join(configDir, 'keys'),
    defaultTheme: env.UCWEB_THEME || 'miyara',
  };
}

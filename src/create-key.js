import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkKey, createKey, identify, KEY_NAME, KeyError } from './keys.js';
import { ask } from './prompt.js';

const USAGE = 'Usage: npm run create-key [-- <remote address>...] [--replace | --check]';

export function parseArgs(argv, env) {
  const flags = argv.filter((arg) => arg.startsWith('-'));
  const unknown = flags.filter((flag) => flag !== '--replace' && flag !== '--check');
  if (unknown.length > 0) throw new KeyError(`Unknown option ${unknown[0]}. ${USAGE}`);
  if (flags.includes('--replace') && flags.includes('--check')) throw new KeyError(`Use --replace or --check, not both. ${USAGE}`);
  const named = argv.filter((arg) => !arg.startsWith('-'));
  const addresses = named.length > 0 ? named : (env.UC_REMOTES ?? '').split(',').map((address) => address.trim()).filter(Boolean);
  if (addresses.length === 0) throw new KeyError(`Name a remote, or set UC_REMOTES. ${USAGE}`);
  const configDir = env.UCWEB_CONFIG_DIR || '/config';
  return {
    addresses,
    mode: flags.includes('--check') ? 'check' : flags.includes('--replace') ? 'replace' : 'create',
    keysDir: env.UC_KEYS_DIR || path.join(configDir, 'keys'),
  };
}

const STATES = {
  works: (remote, file) => `The key in ${file} works on ${remote.name} (${remote.address}).`,
  missing: (remote, file) => `${remote.name} (${remote.address}) has no key yet: expected ${file}.`,
  rejected: (remote, file) => `${remote.name} (${remote.address}) rejects the key in ${file}.`,
};

export async function run({ argv, env, askPin, log, warn }) {
  const { addresses, mode, keysDir } = parseArgs(argv, env);
  let failed = false;
  for (const address of addresses) {
    try {
      const remote = await identify(address);
      const before = await checkKey(remote, keysDir);
      if (mode === 'check' || (mode === 'create' && before.state === 'works')) {
        log(STATES[before.state](remote, before.file));
        if (before.state === 'works' && mode === 'create') log(`  Nothing to do. Use --replace for a new ${KEY_NAME} key.`);
        if (before.state !== 'works') failed = true;
        continue;
      }
      if (before.state === 'rejected') log(STATES.rejected(remote, before.file));
      const pin = await askPin(`Web-configurator PIN for ${remote.name} (${address}): `);
      const { file, revoked } = await createKey(remote, keysDir, pin, { replace: mode === 'replace' });
      for (const id of revoked) log(`Revoked the old ${KEY_NAME} key ${id} on ${remote.name}.`);
      log(`Created the ${KEY_NAME} key for ${remote.name} and stored it in ${file}.`);
      const after = await checkKey(remote, keysDir);
      log(STATES[after.state](remote, after.file));
      if (after.state !== 'works') failed = true;
    } catch (error) {
      if (!(error instanceof KeyError)) throw error;
      warn(error.message);
      failed = true;
    }
  }
  if (!failed && mode !== 'check') log('ucweb picks the keys up on its own within 30 seconds; no restart needed.');
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await run({
      argv: process.argv.slice(2),
      env: process.env,
      askPin: (question) => ask(question, { command: 'create-key' }),
      log: (line) => console.log(line),
      warn: (line) => console.error(line),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

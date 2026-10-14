import { chown, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashPin, PIN_PATTERN } from './auth.js';
import { ask as prompt } from './prompt.js';

const ask = (question) => prompt(question, { command: 'set-pin' });

const configDir = process.env.UCWEB_CONFIG_DIR || '/config';
const file = path.join(configDir, 'pin.hash');

try {
  const pin = await ask('New PIN (4 to 12 digits): ');
  if (!PIN_PATTERN.test(pin)) throw new Error('The PIN must be 4 to 12 digits. Nothing was changed.');
  if ((await ask('Type it again: ')) !== pin) throw new Error('The two PINs differ. Nothing was changed.');
  await mkdir(configDir, { recursive: true });
  await writeFile(`${file}.tmp`, `${await hashPin(pin)}\n`, { mode: 0o600 });
  if (process.getuid?.() === 0) {
    const owner = await stat(configDir);
    await chown(`${file}.tmp`, owner.uid, owner.gid);
  }
  await rename(`${file}.tmp`, file);
  console.log(`PIN saved to ${file}. Every browser that was signed in must sign in again.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

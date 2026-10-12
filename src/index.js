import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Auth } from './auth.js';
import { loadConfig } from './config.js';
import { Remote } from './remote.js';
import { createServer, discoverThemes } from './server.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const themes = await discoverThemes(publicDir);
if (!themes.some((theme) => theme.id === config.defaultTheme)) {
  console.error(`UCWEB_THEME is "${config.defaultTheme}", but the themes are: ${themes.map((theme) => theme.id).join(', ')}.`);
  process.exit(1);
}

const auth = new Auth({ configDir: config.configDir });
await auth.init();
if (!(await auth.pinConfigured())) console.warn('No PIN is set yet. Run: docker exec -it ucweb npm run set-pin');

const remotes = config.remotes.map((address) => new Remote({ address, keysDir: config.keysDir }));
for (const remote of remotes) {
  let lastStatus = null;
  remote.on('change', (snapshot) => {
    const status = snapshot.online ? `connected to ${snapshot.name}.` : snapshot.problem;
    if (status !== lastStatus) {
      lastStatus = status;
      console.log(`${snapshot.address}: ${status}`);
    }
  });
  remote.on('warning', (message) => console.warn(message));
  remote.start();
}

const server = createServer({ remotes, publicDir, themes, defaultTheme: config.defaultTheme, auth });
server.listen(config.port, () => console.log(`ucweb listening on port ${config.port}.`));

const shutdown = () => {
  for (const remote of remotes) remote.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

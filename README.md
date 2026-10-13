# ucweb

A web remote for [Unfolded Circle](https://www.unfoldedcircle.com/) Remote 3 and Remote Two. Open it on a phone
or in a desktop browser to start and stop activities, drive the D-pad, volume and transport buttons, and watch
every remote's status live.

- **Activities**: every activity on each remote, with its live state (on, off, working, error). Tap to start,
  tap again to control, one tap to turn off.
- **Control pad**: D-pad and OK, back, home, menu, volume, mute, channel, play/pause, previous, next, stop and
  record. Each button sends exactly what the activity's own button mapping sends; buttons the activity does not
  use are dimmed, and buttons it does not have are hidden. Hold volume, channel or an arrow to repeat. On a
  desktop the keyboard works too: arrows, Enter, Backspace, + and -, M and Space.
- **Activity pages**: the pages you built for each activity in the web configurator, laid out on the same grid.
  Swipe, use the arrows or dots, or press `[` and `]` to slide between them. A Pages | Controls switch (or `T` on a
  keyboard) flips between the pages and the control pad, and each browser remembers which one you use. The keyboard
  shortcuts for the pad work in both views. Buttons send exactly the command the
  page stores. Media widgets show artwork, title, artist and live progress, and sensor and select widgets show their
  current value, all updated live. ucweb draws every icon itself in the current theme, picked from what the button
  does (the input it selects, the app it opens, the command it sends), so a page looks the same in every theme.
  Apps are shown by name, never by logo. The last page you looked at is remembered for each activity.
- **Live status**: connection, battery level and charging, power supply, power mode (awake, idle, low power,
  asleep) and the device's model and firmware, updated as they change.
- **Several remotes**: switch between them at the top of the page.
- **PIN sign-in**: one PIN for the whole app, kept as a scrypt hash. A browser stays signed in for 30 days.
- **Themes**: Miyara (the default), Original, Obsidian & Copper, Roon Dark, Roon Light, Dark Orange,
  Graphite & Brass, Brookwood and Brookwood Light. Each browser keeps its own choice.

ucweb only controls. It never changes a remote's configuration: use the remote's web configurator for that.
Select widgets, numpad items and the full player view are not built yet
([#13](https://github.com/guyp2k/ucweb/issues/13), [#14](https://github.com/guyp2k/ucweb/issues/14),
[#15](https://github.com/guyp2k/ucweb/issues/15)).

## How it works

A small Node server holds one API key per remote, keeps a live WebSocket connection to each remote's Core API,
and serves the web app. The browser talks only to ucweb, never to the remotes, so the keys never leave the
server. The server sends only four kinds of command: start or stop an activity, press a button that the activity maps, press
an item on one of the activity's pages, and reboot or power off the remote. It looks the command up itself, so a browser can only name a button or
a page item, never send an arbitrary command to your devices. Album art is fetched by the server from the address
the player reports, without the API key, and only image types are passed on.

## Install

### 1. Create an API key on each remote

On any computer with `curl` and `python3` on the same network:

```sh
UC_KEYS_DIR=./keys scripts/create-api-key.sh 192.168.1.20
```

It asks for the remote's web-configurator PIN once, creates a key named `ucweb` and saves it as
`keys/<remote hostname>.key` (for example `keys/Remote3-66ebba.key`). Run it once per remote. Use `--replace` to
issue a new key, or `--check` to test a stored one.

### 2. Run the container

Put the key files in the `keys` folder of the config volume, then start ucweb with your remotes' addresses:

```sh
docker run -d --name ucweb --init --restart unless-stopped \
  -p 8080:8080 \
  -v /path/to/ucweb:/config \
  -e UC_REMOTES=192.168.1.20,192.168.1.21 \
  ghcr.io/guyp2k/ucweb:latest
```

Or with Compose:

```yaml
services:
  ucweb:
    image: ghcr.io/guyp2k/ucweb:latest
    init: true
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - /path/to/ucweb:/config
    environment:
      UC_REMOTES: 192.168.1.20,192.168.1.21
```

**Unraid**: use the template in `unraid/ucweb.xml` (Docker tab, Add Container, Template URL
`https://raw.githubusercontent.com/guyp2k/ucweb/main/unraid/ucweb.xml`).

### 3. Set the PIN

```sh
docker exec -it ucweb npm run set-pin
```

Then open `http://<server>:8080/` and sign in. Run it again to change the PIN; that signs every browser out.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `UC_REMOTES` | (required) | Remote addresses, comma separated. A port is allowed (`192.168.1.20:8080`). |
| `UCWEB_CONFIG_DIR` | `/config` | Holds `keys/`, `pin.hash` and `session.secret`. |
| `UC_KEYS_DIR` | `$UCWEB_CONFIG_DIR/keys` | Where the `<hostname>.key` files are. |
| `PORT` | `8080` | Port the web app listens on. |
| `UCWEB_THEME` | `miyara` | Theme for browsers that have not picked one: `miyara`, `original`, `copper`, `roon`, `roon-light`, `dark-orange`, `graphite-brass`, `brookwood` or `brookwood-light`. |
| `PUID` / `PGID` | `1000` | Owner of the config folder. The container fixes the folder's ownership at start and then drops root. Unraid uses 99 and 100. |

## Security

- Keep ucweb on your LAN. Never forward its port to the internet: the API keys it holds have admin scope on
  your remotes.
- Wrong PINs are throttled: after five misses a browser's address waits 30 seconds, doubling up to 15 minutes,
  and 30 misses in 15 minutes from anywhere lock sign-in for everyone until the window passes.
- The session cookie is `HttpOnly` and `SameSite=Strict`, commands must come from the app's own page, and every
  response carries a strict Content Security Policy.

## Development

```sh
npm install
npm test        # node:test, against a fake remote that speaks the Core API's REST and WebSocket
npm run lint
UC_REMOTES=192.168.1.20 UCWEB_CONFIG_DIR=./dev npm start
```

Node 20 or later. The browser code is plain ES modules with no build step.

### Against the Unfolded Circle core simulator

`npm run test:sim` runs ucweb against the real Core API in
[unfoldedcircle/core-simulator](https://github.com/unfoldedcircle/core-simulator): it creates an API key and two
activities, then starts, presses, renames and deletes through ucweb and checks the live events. CI runs it on every
push before the image is built.

```sh
docker run -d --name core-simulator -p 8080:8080 unfoldedcircle/core-simulator:0.81.2-bt
UC_SIM=127.0.0.1:8080 npm run test:sim
```

The last test sends REBOOT, which stops the simulator; start it again for the next run. `UC_SIM_USER` and
`UC_SIM_PASSWORD` default to the simulator's `web-configurator` / `1234`. The simulator is licensed for development
use only and is never part of the ucweb image.

## Credits

- The Remote's API is documented in [unfoldedcircle/core-api](https://github.com/unfoldedcircle/core-api).
- The Original, Obsidian & Copper, Roon Dark, Roon Light, Dark Orange, Graphite & Brass and Miyara themes
  follow the themes of [Rabbit Hole Fork](https://github.com/guyp2k/RabbitHole-Fork). Graphite & Brass follows
  [Rouen](https://github.com/meltface-80/Rouen).
- Fonts are under the SIL Open Font License; each theme's `fonts/LICENSE.txt` lists them.
- Most page icons follow the geometry of [Lucide](https://lucide.dev) (ISC License); the connector icons are drawn
  for ucweb. See `public/icons.LICENSE.txt`.

ucweb is an independent project and is not affiliated with or endorsed by Unfolded Circle.

## License

MIT

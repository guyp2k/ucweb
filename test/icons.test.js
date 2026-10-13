import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, ICONS, resolveIcon, SOURCES, UC_NAMES } from '../public/icons.js';

const shown = (icon, hint = null) => {
  const { key, glyph, caption, app } = resolveIcon({ icon, hint });
  return [key ?? glyph ?? (app ? 'app' : 'text'), caption];
};

test('every icon name ucweb knows draws an icon it has', () => {
  const keys = [...Object.values(UC_NAMES), ...SOURCES.map(([, key]) => key), ...ACTIONS.map(([, key]) => key)];
  for (const key of keys) assert.ok(ICONS[key], key);
});

test('every icon is plain path data on the 24 point grid', () => {
  for (const [key, paths] of Object.entries(ICONS)) {
    assert.ok(paths.length > 0, key);
    for (const d of paths) {
      assert.match(d, /^[Mm][MmLlHhVvCcSsQqAaZz0-9.,\s-]+$/, key);
      for (const value of d.match(/-?\d*\.?\d+/g)) assert.ok(Math.abs(Number(value)) <= 24, `${key}: ${value}`);
    }
  }
});

test('built-in remote icons draw their own glyph, digits as text', () => {
  assert.deepEqual(shown('uc:angles-up'), ['angles-up', null]);
  assert.deepEqual(shown('uc:angles-down'), ['angles-down', null]);
  assert.deepEqual(shown('uc:gear'), ['settings', null]);
  assert.deepEqual(shown('uc:8'), ['8', null]);
});

test('an icon follows what its button does, not what its file is called', () => {
  assert.deepEqual(shown('custom:hdmi4.png', 'APP_SWITCHER'), ['apps', null]);
  assert.deepEqual(shown('custom:rca.png', 'Optical In'), ['optical', 'Optical']);
  assert.deepEqual(shown('custom:HDMI.png', 'OUTPUT_IIS'), ['hdmi', 'I2S']);
  assert.deepEqual(shown('custom:optical.png', 'Coaxial In'), ['rca', 'Coaxial']);
});

test('inputs and outputs get a connector and a caption naming the port', () => {
  assert.deepEqual(shown('custom:hdmi1.png', 'INPUT_HDMI1'), ['hdmi', 'HDMI 1']);
  assert.deepEqual(shown('custom:USB.png', 'USB-B In'), ['usb', 'USB-B']);
  assert.deepEqual(shown('custom:optical.png', 'Optical 1 In'), ['optical', 'Optical 1']);
  assert.deepEqual(shown('custom:HDMI.png', 'ARC In'), ['hdmi', 'ARC']);
  assert.deepEqual(shown('custom:bt.png', 'Bluetooth In'), ['bluetooth', 'Bluetooth']);
  assert.deepEqual(shown('custom:media-player.png', 'Internal player'), ['streamer', 'Internal player']);
  assert.deepEqual(shown('custom:rca_xlr.png', 'OUTPUT_XLRRCA'), ['xlr', 'XLR / RCA']);
  assert.deepEqual(shown('custom:xlr_.png', 'OUTPUT_XLR'), ['xlr', 'XLR']);
});

test('apps are named, never drawn with someone else\'s logo', () => {
  assert.deepEqual(shown('custom:tv-ecd84a06-b89a-4b29-aa37-60e4ba1ea03e.png', 'Netflix'), ['app', 'Netflix']);
  assert.deepEqual(shown('custom:tv-46f2ceb0.png', 'Spotify'), ['app', 'Spotify']);
  assert.deepEqual(shown('custom:tv-5ec93837.png', 'Youtube'), ['app', 'YouTube']);
  assert.deepEqual(shown('custom:tv-173ee339.png', 'com.aspiro.tidal'), ['app', 'TIDAL']);
  assert.deepEqual(shown('custom:tv-be8d68c2.png', 'com.amazon.amazonvideo.livingroom'), ['app', 'Prime Video']);
  assert.deepEqual(shown('custom:tv-ba03e5e9.png', 'com.google.android.youtube.tvunplugged'), ['app', 'YouTube TV']);
  assert.deepEqual(shown('custom:fandango_1.png', 'air.com.vudu.air.DownloaderTablet'), ['app', 'Fandango at Home']);
  assert.deepEqual(shown('custom:AppleTVApp.png', 'Apple TV'), ['app', 'Apple TV']);
  assert.deepEqual(shown('custom:Plex_2.png', 'Plex'), ['app', 'Plex']);
  assert.deepEqual(shown('custom:x.png', 'com.example.coolstream.MainActivity'), ['app', 'Example']);
  assert.deepEqual(shown('custom:x.png', 'Some New Service'), ['app', 'Some New Service']);
});

test('player commands draw the navigation glyph without a caption', () => {
  assert.deepEqual(shown('custom:lg_remote_back.png', 'media_player.back'), ['back', null]);
  assert.deepEqual(shown('custom:lg_remote_home.png', 'media_player.home'), ['house', null]);
  assert.deepEqual(shown('custom:lg_remote_q_settings.png', 'media_player.settings'), ['settings', null]);
  assert.deepEqual(shown('custom:lg_remote_stb_menu.png', 'media_player.context_menu'), ['more', null]);
  assert.deepEqual(shown('custom:Menu-Colour.png', 'media_player.menu'), ['menu', null]);
  assert.deepEqual(shown('custom:ht-bypass.png', 'HT_Bypass'), ['bypass', 'HT Bypass']);
});

test('without a hint the file name decides, ignoring ids and version marks', () => {
  assert.deepEqual(shown('custom:bt.png'), ['bluetooth', 'Bluetooth']);
  assert.deepEqual(shown('custom:media-player.png'), ['streamer', 'Player']);
  assert.deepEqual(shown('custom:hdmi-X.png'), ['hdmi', 'HDMI']);
  assert.deepEqual(shown('custom:tv-892100b1-e973-4ab3-b0b0-fe1a37303532.png'), ['tv', 'TV']);
  assert.deepEqual(shown('custom:whatever.png', 'media_player.select_source'), ['text', 'Whatever']);
});

test('short port names only match whole words', () => {
  assert.deepEqual(shown('custom:search.png'), ['search', null]);
  assert.deepEqual(shown('custom:subtitles.png'), ['subtitles', null]);
  assert.deepEqual(shown('uc:nonsense-thing'), ['text', 'Nonsense Thing']);
});

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const SPEAKER = 'M11 5 6 9H2v6h4l5 4z';

export const ICONS = {
  'angles-up': ['m7 13 5-5 5 5', 'm7 18 5-5 5 5'],
  'angles-down': ['m7 6 5 5 5-5', 'm7 11 5 5 5-5'],
  'angles-left': ['m13 7-5 5 5 5', 'm18 7-5 5 5 5'],
  'angles-right': ['m6 7 5 5-5 5', 'm11 7 5 5-5 5'],
  'angle-up': ['m6 15 6-6 6 6'],
  'angle-down': ['m6 9 6 6 6-6'],
  'angle-left': ['m15 6-6 6 6 6'],
  'angle-right': ['m9 6 6 6-6 6'],
  'arrow-up': ['M12 19V5', 'm6 11 6-6 6 6'],
  'arrow-down': ['M12 5v14', 'm6 13 6 6 6-6'],
  'arrow-left': ['M19 12H5', 'm11 6-6 6 6 6'],
  'arrow-right': ['M5 12h14', 'm13 6 6 6-6 6'],
  'caret-up': ['m7 14 5-5 5 5z'],
  'caret-down': ['m7 10 5 5 5-5z'],
  'caret-left': ['m14 7-5 5 5 5z'],
  'caret-right': ['m10 7 5 5-5 5z'],
  settings: [
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    circle(12, 12, 3),
  ],
  house: [
    'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8',
    'M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
  back: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  more: [circle(12, 5, 1), circle(12, 12, 1), circle(12, 19, 1)],
  info: [circle(12, 12, 10), 'M12 16v-4', 'M12 8h.01'],
  power: ['M12 2v10', 'M18.4 6.6a9 9 0 1 1-12.77.04'],
  play: ['M6 3.5v17a1 1 0 0 0 1.5.86l13.6-8.5a1 1 0 0 0 0-1.72L7.5 2.64A1 1 0 0 0 6 3.5z'],
  pause: ['M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'],
  'play-pause': ['M3 5v14l9-7z', 'M16 6v12', 'M21 6v12'],
  stop: ['M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'],
  next: ['M5 4l10 8-10 8z', 'M19 5v14'],
  previous: ['M19 20 9 12l10-8z', 'M5 19V5'],
  'fast-forward': ['M13 19l9-7-9-7z', 'M2 19l9-7-9-7z'],
  rewind: ['M11 19 2 12l9-7z', 'M22 19l-9-7 9-7z'],
  record: [circle(12, 12, 9), circle(12, 12, 4)],
  'volume-up': [SPEAKER, 'M16 9a5 5 0 0 1 0 6', 'M19.4 5.6a9 9 0 0 1 0 12.8'],
  'volume-down': [SPEAKER, 'M16 9a5 5 0 0 1 0 6'],
  mute: [SPEAKER, 'm22 9-6 6', 'm16 9 6 6'],
  plus: ['M5 12h14', 'M12 5v14'],
  minus: ['M5 12h14'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  check: ['M20 6 9 17l-5-5'],
  search: [circle(11, 11, 8), 'm21 21-4.3-4.3'],
  list: ['M3 6h.01', 'M3 12h.01', 'M3 18h.01', 'M8 6h13', 'M8 12h13', 'M8 18h13'],
  apps: [
    'M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z',
    'M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z',
  ],
  shuffle: ['m18 14 4 4-4 4', 'm18 2 4 4-4 4', 'M2 18h2a4 4 0 0 0 3.3-1.7l5.4-8.6A4 4 0 0 1 16 6h6', 'M2 6h2a4 4 0 0 1 3.4 1.9', 'M22 18h-6a4 4 0 0 1-3.3-1.8l-.4-.5'],
  repeat: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  bypass: ['M3 12h14', 'm11 6 6 6-6 6', 'M21 5v14'],
  input: ['m10 17 5-5-5-5', 'M15 12H3', 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4'],
  output: ['m16 17 5-5-5-5', 'M21 12H9', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'],
  hdmi: ['M3 8h18v4.6a1 1 0 0 1-.3.7l-2.8 2.9a1 1 0 0 1-.7.3H6.8a1 1 0 0 1-.7-.3l-2.8-2.9a1 1 0 0 1-.3-.7z', 'M7 11.5h10'],
  usb: [circle(12, 19.5, 1.8), 'M12 17.7V4', 'm9.5 6.5 2.5-3 2.5 3', 'M12 15.5 7.5 13v-2.6', circle(7.5, 9.1, 1.3), 'M12 13l4.5-2.4V8.4', 'M15.3 6h2.4v2.4h-2.4z'],
  optical: ['M6 5h12a1 1 0 0 1 1 1v8.6a1 1 0 0 1-.3.7l-2.4 2.4a1 1 0 0 1-.7.3H8.4a1 1 0 0 1-.7-.3l-2.4-2.4a1 1 0 0 1-.3-.7V6a1 1 0 0 1 1-1z', circle(12, 11, 2.4), 'M12 20v2'],
  rca: [circle(12, 12, 9), circle(12, 12, 4.5), circle(12, 12, 1)],
  xlr: [circle(12, 12, 9), circle(8.7, 10.4, 1.2), circle(15.3, 10.4, 1.2), circle(12, 15.8, 1.2), 'M10.5 3h3'],
  bluetooth: ['m7 7 10 10-5 5V2l5 5L7 17'],
  streamer: ['M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M9.5 9.8v4.4l3.8-2.2z', 'M18 12h.01'],
  tv: ['M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'm17 2-5 5-5-5'],
  display: ['M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 21h8', 'M12 17v4'],
  cast: ['M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1', 'm12 15 5 6H7z'],
  network: ['m15 20 3-3h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2l3 3z', 'M6 8v1', 'M10 8v1', 'M14 8v1', 'M18 8v1'],
  wifi: ['M12 20h.01', 'M2 8.8a15 15 0 0 1 20 0', 'M5 12.9a10 10 0 0 1 14 0', 'M8.5 16.4a5 5 0 0 1 7 0'],
  disc: [circle(12, 12, 10), circle(12, 12, 2)],
  music: ['M9 18V5l12-2v13', circle(6, 18, 3), circle(18, 16, 3)],
  headphones: ['M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3'],
  speaker: ['M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', circle(12, 14, 4), 'M12 6h.01'],
  mic: ['M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  lightbulb: ['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'],
  sun: [circle(12, 12, 4), 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  heart: ['M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z'],
  star: ['M11.5 2.3a.5.5 0 0 1 1 0l2.3 4.7a2.1 2.1 0 0 0 1.6 1.2l5.2.7a.5.5 0 0 1 .3.9l-3.8 3.7a2.1 2.1 0 0 0-.6 1.9l.9 5.1a.5.5 0 0 1-.8.6l-4.6-2.4a2.1 2.1 0 0 0-2 0l-4.6 2.4a.5.5 0 0 1-.8-.6l.9-5.1a2.1 2.1 0 0 0-.6-1.9L2.2 9.8a.5.5 0 0 1 .3-.9l5.2-.8a2.1 2.1 0 0 0 1.6-1.2z'],
  subtitles: ['M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z', 'M7 15h4', 'M15 15h2', 'M7 11h2', 'M13 11h4'],
  devices: ['M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8', 'M7 19h5', 'M10 15v4', 'M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z'],
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z'],
  library: ['M21 15V6', circle(18.5, 15.5, 2.5), 'M12 12H3', 'M16 6H3', 'M12 18H3'],
  radio: ['M4.9 19.1C1 15.2 1 8.8 4.9 4.9', 'M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5', circle(12, 12, 2), 'M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5', 'M19.1 4.9C23 8.8 23 15.1 19.1 19'],
  tag: ['M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z', circle(7.5, 7.5, 0.5)],
  guide: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M3 9h18', 'M9 21V9'],
  thermometer: ['M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z'],
  droplet: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'],
  gauge: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
  plug: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z'],
  remote: ['M9 2h6a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z', circle(12, 8, 2), 'M10 14h.01', 'M14 14h.01', 'M10 18h4'],
  blinds: ['M3 3h18', 'M20 7H8', 'M20 11H8', 'M10 19h10', 'M8 15h12', 'M4 3v14', circle(4, 19, 2)],
  zap: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
  button: ['M5 8h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z', 'M9 12h6'],
  camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z', circle(12, 13, 3)],
  layers: ['M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z', 'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'],
  puzzle: ['M15.39 4.39a1 1 0 0 0 1.68-.47 2.5 2.5 0 1 1 3.01 3.01 1 1 0 0 0-.47 1.68l1.68 1.68a2.41 2.41 0 0 1 0 3.42l-1.68 1.68a1 1 0 0 1-1.68-.47 2.5 2.5 0 1 0-3.01 3.01 1 1 0 0 1 .47 1.68l-1.68 1.68a2.41 2.41 0 0 1-3.42 0l-1.68-1.68a1 1 0 0 0-1.68.47 2.5 2.5 0 1 1-3.01-3.01 1 1 0 0 0 .47-1.68l-1.68-1.68a2.41 2.41 0 0 1 0-3.42l1.68-1.68a1 1 0 0 1 1.68.47 2.5 2.5 0 1 0 3.01-3.01 1 1 0 0 1-.47-1.68l1.68-1.68a2.41 2.41 0 0 1 3.42 0z'],
  flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
  snowflake: ['M2 12h20', 'M12 2v20', 'm20 16-4-4 4-4', 'm4 8 4 4-4 4', 'm16 4-4 4-4-4', 'm8 20 4-4 4 4'],
  fan: [circle(12, 12, 1.5), 'M10.83 13.83a4 4 0 0 1-5.66-5.66l2.12 2.12', 'M13.17 10.17a4 4 0 0 1 5.66 5.66l-2.12-2.12', 'M10.17 10.83a4 4 0 0 1 5.66-5.66l-2.12 2.12', 'M13.83 13.17a4 4 0 0 1-5.66 5.66l2.12-2.12'],
};

export const UC_NAMES = {
  'angles-up': 'angles-up', 'angle-double-up': 'angles-up', 'angles-down': 'angles-down', 'angle-double-down': 'angles-down',
  'angles-left': 'angles-left', 'angles-right': 'angles-right',
  'angle-up': 'angle-up', 'chevron-up': 'angle-up', 'angle-down': 'angle-down', 'chevron-down': 'angle-down',
  'angle-left': 'angle-left', 'chevron-left': 'angle-left', 'angle-right': 'angle-right', 'chevron-right': 'angle-right',
  'arrow-up': 'arrow-up', 'arrow-down': 'arrow-down', 'arrow-left': 'arrow-left', 'arrow-right': 'arrow-right',
  'caret-up': 'caret-up', 'caret-down': 'caret-down', 'caret-left': 'caret-left', 'caret-right': 'caret-right',
  gear: 'settings', gears: 'settings', cog: 'settings', sliders: 'settings',
  house: 'house', home: 'house', 'arrow-rotate-left': 'back', 'arrow-left-long': 'back', 'rotate-left': 'back',
  bars: 'menu', 'ellipsis-vertical': 'more', ellipsis: 'more', 'circle-info': 'info', info: 'info',
  'power-off': 'power', power: 'power', play: 'play', pause: 'pause', 'play-pause': 'play-pause', stop: 'stop',
  'forward-step': 'next', 'backward-step': 'previous', forward: 'fast-forward', 'forward-fast': 'fast-forward',
  backward: 'rewind', 'backward-fast': 'rewind', 'circle-dot': 'record', circle: 'record',
  'volume-high': 'volume-up', 'volume-low': 'volume-down', 'volume-xmark': 'mute', 'volume-off': 'mute',
  plus: 'plus', minus: 'minus', xmark: 'close', check: 'check', 'magnifying-glass': 'search', list: 'list',
  'table-cells-large': 'apps', grip: 'apps', shuffle: 'shuffle', repeat: 'repeat',
  'right-to-bracket': 'input', 'right-from-bracket': 'output', tv: 'tv', display: 'display', desktop: 'display',
  bluetooth: 'bluetooth', wifi: 'wifi', 'compact-disc': 'disc', music: 'music', headphones: 'headphones',
  microphone: 'mic', lightbulb: 'lightbulb', moon: 'moon', sun: 'sun', heart: 'heart', star: 'star',
  'closed-captioning': 'subtitles', 'table-list': 'guide',
  folder: 'folder', 'folder-open': 'folder', 'list-music': 'library', 'file-music': 'music', radio: 'radio',
  'masks-theater': 'tag', tag: 'tag', tags: 'tag',
  light: 'lightbulb', climate: 'thermometer', thermostat: 'thermometer', 'temperature-half': 'thermometer', sensor: 'gauge',
  switch: 'plug', plug: 'plug', mediaplayer: 'music', 'media-player': 'music', remote: 'remote', cover: 'blinds', blinds: 'blinds',
  macro: 'zap', bolt: 'zap', button: 'button', camera: 'camera', video: 'camera', integration: 'puzzle', 'puzzle-piece': 'puzzle',
  droplet: 'droplet', speaker: 'speaker',
};

export const SOURCES = [
  ['earc', 'hdmi', 'eARC'], ['arc', 'hdmi', 'ARC'], ['hdmi', 'hdmi', 'HDMI'], ['iis', 'hdmi', 'I2S'], ['i2s', 'hdmi', 'I2S'],
  ['usb', 'usb', 'USB'], ['toslink', 'optical', 'Optical'], ['optical', 'optical', 'Optical'], ['spdif', 'optical', 'S/PDIF'],
  ['coaxial', 'rca', 'Coaxial'], ['coax', 'rca', 'Coaxial'], ['rca', 'rca', 'RCA'], ['xlr', 'xlr', 'XLR'],
  ['analog', 'rca', 'Analog'], ['aux', 'rca', 'Aux'], ['phono', 'disc', 'Phono'],
  ['bluetooth', 'bluetooth', 'Bluetooth'], ['bt', 'bluetooth', 'Bluetooth'], ['airplay', 'cast', 'AirPlay'],
  ['chromecast', 'cast', 'Chromecast'], ['cast', 'cast', 'Cast'], ['ethernet', 'network', 'Network'], ['network', 'network', 'Network'],
  ['player', 'streamer', 'Player'], ['streamer', 'streamer', 'Streamer'], ['tv', 'tv', 'TV'],
];

export const ACTIONS = [
  ['back', 'back'], ['home', 'house'], ['settings', 'settings'], ['setting', 'settings'], ['context', 'more'], ['options', 'more'],
  ['menu', 'menu'], ['switcher', 'apps'], ['apps', 'apps'], ['info', 'info'], ['guide', 'guide'], ['search', 'search'],
  ['power', 'power'], ['bypass', 'bypass'], ['exit', 'close'], ['subtitle', 'subtitles'], ['mute', 'mute'],
];

const CAPTIONED = new Set(['bypass']);

const APPS = new Map([
  ['netflix', 'Netflix'], ['com.netflix.ninja', 'Netflix'], ['spotify', 'Spotify'], ['com.spotify.tv.android', 'Spotify'],
  ['youtube', 'YouTube'], ['com.google.android.youtube.tv', 'YouTube'], ['youtube tv', 'YouTube TV'],
  ['com.google.android.youtube.tvunplugged', 'YouTube TV'], ['youtube music', 'YouTube Music'],
  ['com.google.android.apps.youtube.music', 'YouTube Music'], ['tidal', 'TIDAL'], ['com.aspiro.tidal', 'TIDAL'],
  ['prime video', 'Prime Video'], ['com.amazon.amazonvideo.livingroom', 'Prime Video'], ['plex', 'Plex'],
  ['com.plexapp.android', 'Plex'], ['hbo max', 'HBO Max'], ['max', 'Max'], ['com.wbd.stream', 'Max'],
  ['disney+', 'Disney+'], ['disney plus', 'Disney+'], ['com.disney.disneyplus', 'Disney+'], ['hulu', 'Hulu'],
  ['com.hulu.livingroomplus', 'Hulu'], ['apple tv', 'Apple TV'], ['appletv', 'Apple TV'], ['appletvapp', 'Apple TV'],
  ['com.apple.atve.androidtv.appletv', 'Apple TV'], ['fandango', 'Fandango at Home'], ['vudu', 'Fandango at Home'],
  ['air.com.vudu.air.downloadertablet', 'Fandango at Home'], ['com.vudu.android.app.tvmainactivity', 'Fandango at Home'],
  ['qobuz', 'Qobuz'], ['roon', 'Roon'], ['kodi', 'Kodi'], ['org.xbmc.kodi', 'Kodi'], ['peacock', 'Peacock'],
  ['paramount+', 'Paramount+'], ['com.cbs.ott', 'Paramount+'], ['pluto tv', 'Pluto TV'], ['tv.pluto.android', 'Pluto TV'],
  ['twitch', 'Twitch'], ['crunchyroll', 'Crunchyroll'], ['apple music', 'Apple Music'], ['amazon music', 'Amazon Music'],
  ['pandora', 'Pandora'], ['sling', 'Sling TV'], ['espn', 'ESPN'], ['steam', 'Steam'],
]);

const PACKAGE_NOISE = new Set(['com', 'org', 'net', 'tv', 'air', 'android', 'app', 'apps', 'androidtv', 'livingroom', 'ott', 'player', 'mainactivity', 'tvmainactivity']);

function words(text) {
  return text.toLowerCase().split(/[^a-z0-9+]+/).filter((word) => word && word !== 'x' && !/^(?=.*\d)[0-9a-f]{4,}$/.test(word));
}

function title(text) {
  return text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function appName(text) {
  const known = APPS.get(text.toLowerCase());
  if (known) return known;
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/i.test(text)) return null;
  const parts = text.toLowerCase().split('.');
  for (let length = parts.length - 1; length >= 2; length -= 1) {
    const prefix = APPS.get(parts.slice(0, length).join('.'));
    if (prefix) return prefix;
  }
  const meaningful = parts.find((part) => !PACKAGE_NOISE.has(part) && part.length > 2);
  return meaningful ? title(meaningful) : null;
}

const SOURCE_WORDS = new Map(SOURCES.map(([word, key, label]) => [word, { key, label }]));
const LONGEST_FIRST = [...SOURCE_WORDS.keys()].sort((a, b) => b.length - a.length);

function segment(token) {
  const parts = [];
  let at = 0;
  while (at < token.length) {
    const word = LONGEST_FIRST.find((candidate) => token.startsWith(candidate, at));
    if (!word) return null;
    const number = token.slice(at + word.length).match(/^\d*/)[0];
    parts.push({ word, number });
    at += word.length + number.length;
  }
  return parts;
}

function connectors(text) {
  const found = [];
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let parts = segment(token);
    if (!parts) {
      const long = LONGEST_FIRST.find((word) => word.length >= 5 && token.includes(word));
      parts = long ? [{ word: long, number: '' }] : [];
    }
    for (const { word, number } of parts) {
      const { key, label } = SOURCE_WORDS.get(word);
      found.push({ key, label: number ? `${label} ${Number(number)}` : label });
    }
  }
  return found;
}

function action(text) {
  const tokens = words(text);
  for (const [word, key] of ACTIONS) {
    if (tokens.some((token) => token === word || token.startsWith(word))) return key;
  }
  return null;
}

function sourceCaption(source) {
  return source.replace(/\s+(in|out|input|output)$/i, '').trim();
}

function fromText(text, { isSource }) {
  const app = isSource ? appName(text) : null;
  const found = connectors(text);
  if (app && !found.some((item) => item.key !== 'tv')) return { key: null, glyph: null, caption: app, app: true };
  if (found.length > 0) {
    const labels = [...new Set(found.map((item) => item.label))];
    const caption = isSource ? sourceCaption(text) : labels.join(' / ');
    return { key: found[0].key, glyph: null, caption, app: false };
  }
  const key = action(text);
  if (key) return { key, glyph: null, caption: CAPTIONED.has(key) ? title(text.replace(/^(input|output)_/i, '')) : null, app: false };
  if (isSource) return { key: null, glyph: null, caption: app ?? text, app: true };
  return null;
}

export function resolveIcon({ icon, hint }) {
  const [prefix, ...rest] = String(icon ?? '').split(':');
  const name = rest.join(':');
  if (prefix === 'uc') {
    if (/^[0-9a-z]$/i.test(name)) return { key: null, glyph: name.toUpperCase(), caption: null, app: false };
    const key = UC_NAMES[name.toLowerCase()];
    if (key) return { key, glyph: null, caption: null, app: false };
  }
  if (hint) {
    const entityCommand = hint.match(/^[a-z_]+\.([a-z_]+)$/);
    const isSource = !entityCommand && !/^[A-Za-z]+(_[A-Za-z0-9]+)+$/.test(hint);
    const resolved = fromText(entityCommand ? entityCommand[1] : hint, { isSource });
    if (resolved) return resolved;
  }
  const file = name.replace(/\.(png|jpe?g|gif|webp|svg)$/i, '');
  if (file) {
    const app = appName(words(file).join(' ')) ?? words(file).map((word) => APPS.get(word)).find(Boolean);
    const found = connectors(file);
    if (found.length > 0) return { key: found[0].key, glyph: null, caption: [...new Set(found.map((item) => item.label))].join(' / '), app: false };
    if (app) return { key: null, glyph: null, caption: app, app: true };
    const key = action(file);
    if (key) return { key, glyph: null, caption: null, app: false };
  }
  return { key: null, glyph: null, caption: title(words(file || name || 'Button').join(' ')) || 'Button', app: false };
}

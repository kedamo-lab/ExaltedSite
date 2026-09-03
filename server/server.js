/* ============================================================
   EXALTED — сервер
   Раздаёт статический сайт и отдаёт живые профили Discord
   через API:  GET /api/member/:id
   ============================================================ */

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const PORT = Number(process.env.PORT) || 3000;
const TOKEN = process.env.DISCORD_TOKEN;

// ID участников администрации, для которых разрешён запрос
const ALLOWED_IDS = new Set([
  '889132845199659029', // Mondschein
  '880812412947820574', // hell私は年後に死ぬ
  '1084756360337555518', // Ocя́ka
  '646425773577732096', // dizmorality
  '515158254557331457', // Schola Iteratorum
  '683924703898763432' // Xlopk4
]);

// ID категорий, войс-каналы которых показываем на главной («Кто в войсе»)
const TRACKED_CATEGORIES = new Set([
  '1497702648705581187',
  '1497697646834618428'
]);

const app = express();
const client = { instance: null, ready: false };

/* ---------- Discord-бот ---------- */

function attachClient(newClient) {
  client.instance = newClient;
  client.instance.on('error', (e) => console.error('[bot error]', e.message));
  newClient.on('voiceStateUpdate', (oldS, newS) => {
    if (newS.channelId) console.log('[voice evt]', newS.id, '→ войс', newS.channelId);
    else if (oldS.channelId) console.log('[voice evt]', oldS.id, '← вышел из', oldS.channelId);
  });
}

function connectBot() {
  if (!TOKEN) {
    console.error('✗ DISCORD_TOKEN не задан в server/.env — живые профили недоступны.');
    return;
  }

  // Пробуем полный набор (включая присутствия)…
  const full = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildVoiceStates
    ]
  });
  attachClient(full);

  full.on('ready', () => {
    client.ready = true;
    console.log('✓ Бот подключён (полный доступ):', full.user.tag, '| серверов:', full.guilds.cache.size);
  });

  full.on('warn', (w) => console.warn('[bot warn]', w));

  full.login(TOKEN).catch((err) => {
    const msg = String((err && err.message) || err);
    if (/intent/i.test(msg) || (err && err.code === 4014)) {
      console.warn('→ Привилегированные интенты выключены. Переподключаюсь без присутствий (активность будет «недоступна»).');
      connectBotBasic();
    } else {
      console.error('✗ Не удалось подключить бота (полный доступ):', msg);
      connectBotBasic();
    }
  });
}

function connectBotBasic() {
  const basic = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates] });
  attachClient(basic);

  basic.on('ready', () => {
    client.ready = true;
    console.log('✓ Бот подключён (без присутствий):', basic.user.tag, '| серверов:', basic.guilds.cache.size);
  });

  basic.on('warn', (w) => console.warn('[bot warn]', w));

  basic.login(TOKEN).catch((err) => {
    const msg = String((err && err.message) || err);
    if (/intent/i.test(msg) || (err && err.code === 4014)) {
      console.warn('→ Интент GuildMembers тоже выключен. Переключаюсь на базовый доступ (REST).');
      connectBotRest();
    } else {
      console.error('✗ Не удалось подключить бота (базовый):', msg);
      connectBotRest();
    }
  });
}

function connectBotRest() {
  const rest = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  attachClient(rest);

  rest.on('ready', () => {
    client.ready = true;
    console.log('✓ Бот подключён (REST):', rest.user.tag, '| серверов:', rest.guilds.cache.size);
  });

  rest.on('warn', (w) => console.warn('[bot warn]', w));

  rest.login(TOKEN).catch((err) => {
    console.error('✗ Не удалось подключить бота совсем:', (err && err.message) || err);
  });
}

/* ---------- Сериализация участника ---------- */

function serializeMember(guild, member, presence) {
  const user = member.user;
  presence = presence || member.presence || null;
  return {
    username: user.username,
    globalName: user.globalName || user.displayName || null,
    avatar: user.displayAvatarURL({ size: 256 }),
    banner: user.bannerURL({ size: 1024 }) || null,
    accentColor: user.hexAccentColor || null,
    nickname: member.nickname || null,
    roles: member.roles.cache
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color === 0 ? null : '#' + r.color.toString(16).padStart(6, '0'),
        position: r.position
      })),
    joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
    premiumSince: member.premiumSince ? member.premiumSince.toISOString() : null,
    guild: { id: guild.id, name: guild.name },
    status: presence ? presence.status : null,
    activities: presence
      ? presence.activities
          .map((a) => ({ name: a.name, state: a.state || null, type: a.type }))
          .filter((a) => a.name)
      : []
  };
}

function serializeUser(user) {
  return {
    username: user.username,
    globalName: user.globalName || user.displayName || null,
    avatar: user.displayAvatarURL({ size: 256 }),
    banner: user.bannerURL({ size: 1024 }) || null,
    accentColor: user.hexAccentColor || null,
    nickname: null,
    roles: [],
    joinedAt: null,
    premiumSince: null,
    guild: null,
    status: null,
    activities: []
  };
}

/* ---------- Поиск участника ---------- */

async function fetchMemberData(userId) {
  const bot = client.instance;
  if (!bot) throw new Error('бот ещё не подключён');

  // Ищем сервер, где есть этот участник
  for (const guild of bot.guilds.cache.values()) {
    // REST: гарантирует роли, joinedAt и баннер
    const member = await guild.members
      .fetch({ user: userId, force: true })
      .catch(() => null);
    if (member) {
      // Активность живёт только в кэше гейтвея — подмешиваем её отдельно
      const presence = guild.presences.cache.get(userId) || null;
      return serializeMember(guild, member, presence);
    }
  }

  // Если бот не в гильдии участника — базовый профиль пользователя
  const user = await bot.users.fetch(userId).catch(() => null);
  if (user) return serializeUser(user);

  throw new Error('участник не найден');
}

/* ---------- HTTP ---------- */

const cache = new Map(); // userId -> { at, data }
const CACHE_TTL = 45000; // 45 секунд, чтобы данные были «почти в реальном времени»

app.disable('x-powered-by');

// Статика: весь корень сайта
app.use(express.static(path.join(__dirname, '..')));

app.use(express.json());

const GALLERY_FILE = path.join(__dirname, 'gallery.json');
const ADMIN_PASS_HASH = '51b2236f03831a3a2dd6261747b48feed1576b8a0ed9234414ce4a0c6e96907d';

// Получение галереи
app.get('/api/gallery', (req, res) => {
  fs.readFile(GALLERY_FILE, 'utf8', (err, data) => {
    if (err) return res.json({});
    try { res.json(JSON.parse(data)); } catch (e) { res.json({}); }
  });
});

// Сохранение галереи
app.post('/api/gallery', (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== ADMIN_PASS_HASH) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  fs.writeFile(GALLERY_FILE, JSON.stringify(req.body), 'utf8', (err) => {
    if (err) {
      console.error('[api/gallery] write error', err);
      return res.status(500).json({ error: 'write_error' });
    }
    res.json({ success: true });
  });
});

// Здоровье сервера
app.get('/api/health', (req, res) => {
  const inst = client.instance;
  const guild = inst && inst.guilds.cache.first();
  res.json({
    ok: true,
    bot: client.ready,
    guilds: inst ? inst.guilds.cache.size : 0,
    members: guild ? guild.members.cache.size : 0,
    presences: guild ? guild.presences.cache.size : 0
  });
});

// Живой профиль участника
app.get('/api/member/:id', async (req, res) => {
  const id = req.params.id;

  if (!/^\d{6,20}$/.test(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  if (!ALLOWED_IDS.has(id)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const fresh = req.query.fresh === '1';
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL) {
    return res.json(hit.data);
  }

  try {
    const data = await fetchMemberData(id);
    cache.set(id, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.error('[api/member]', id, '→', e.message);
    res.status(502).json({ error: e.message });
  }
});

/* ---------- Войс-каналы («Кто в войсе») ---------- */

function serializeVoiceMember(guild, state) {
  const m = state.member || guild.members.cache.get(state.id);
  if (!m) return null;
  const user = m.user;
  const presence = guild.presences.cache.get(user.id) || null;
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName || null,
    nickname: m.nickname || null,
    avatar: user.displayAvatarURL({ size: 64 }),
    status: presence ? presence.status : null,
    selfMute: Boolean(state.selfMute || state.serverMute),
    selfDeaf: Boolean(state.selfDeaf || state.serverDeaf),
    streaming: Boolean(state.streaming)
  };
}

// Список войс-каналов из отслеживаемых категорий + кто в них сидит
app.get('/api/voice', (req, res) => {
  const bot = client.instance;
  if (!bot || !client.ready) {
    return res.status(503).json({ error: 'bot_offline', categories: [] });
  }

  const categories = [];

  for (const guild of bot.guilds.cache.values()) {
    const catList = guild.channels.cache
      .filter((c) => c.type === 4 && TRACKED_CATEGORIES.has(c.id))
      .sort((a, b) => a.position - b.position);

    for (const cat of catList.values()) {
      const channels = [];
      const voiceList = guild.channels.cache
        .filter((c) => c.parentId === cat.id && c.type === 2) // только голосовые
        .sort((a, b) => a.position - b.position);

      for (const ch of voiceList.values()) {
        const states = guild.voiceStates.cache.filter((v) => v.channelId === ch.id);
        const members = states
          .map((v) => serializeVoiceMember(guild, v))
          .filter(Boolean);
        channels.push({ id: ch.id, name: ch.name, members });
      }

      categories.push({ id: cat.id, name: cat.name, channels });
    }
  }

  res.json({ categories, at: Date.now() });
});

/* ---------- Запуск ---------- */

app.listen(PORT, () => {
  console.log('');
  console.log('===========================================');
  console.log('  Exalted — http://localhost:' + PORT);
  console.log('===========================================');
  console.log('');
  connectBot();
});

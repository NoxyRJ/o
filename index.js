/* ================= IMPORTS DISCORD ================= */
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require("discord.js");

/* ================= OUTROS IMPORTS ================= */
const fs = require("fs");

/* ✅ GARANTIR FETCH (Node 18+ já tem; Node <18 precisa instalar node-fetch) */
let fetchFn = globalThis.fetch;
if (!fetchFn) {
  // npm i node-fetch@2
  // eslint-disable-next-line global-require
  fetchFn = require("node-fetch");
}
const fetch = (...args) => fetchFn(...args);

/* ================= LOG ================= */
const log = require("./logger");

/* ================= CONFIGURAÇÕES ================= */
const { token } = require("./config.json");
const { initDB, getDB } = require("./database");

/* ================= CONSTANTES ================= */
const OWNER_ID = "278691315594559489";
const DATA_FILE = "./data.json";

/** ⏳ tempo para apagar as DMs de notificação (ms)
 *  60_000 = 1 minuto | 300_000 = 5 minutos | 0 = não apagar
 */
const NOTIF_TTL_MS = 0; // 0 = não apagar

/* ================= VARIÁVEIS ================= */
const runningEstimates = new Set();
let lastResetDay = new Date().getDate();
let db;

/* ✅ LOCK DO LOOP (não empilha rodada) */
let isCheckingLoop = false;

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

/* ================= LOGS DE ERRO GLOBAL ================= */
process.on("unhandledRejection", (err) => {
  const msg = err?.stack || err?.message || String(err);
  log(`UnhandledRejection: ${msg}`, "ERROR");
});
process.on("uncaughtException", (err) => {
  const msg = err?.stack || err?.message || String(err);
  log(`UncaughtException: ${msg}`, "ERROR");
});

/* ================= DATA (JSON) ================= */
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    // ✅ MIGRAÇÃO: se seu JSON antigo era "um tracker só", converte pro novo formato
    const migrated = { ...raw };

    for (const uid of Object.keys(migrated)) {
      const u = migrated[uid];
      if (!u || typeof u !== "object") continue;

      // já no formato novo
      if (u.targets && typeof u.targets === "object") {
        if (u.targets?.profile && typeof u.targets.profile === "object") {
          if (u.targets.profile.lastFollowerId == null) u.targets.profile.lastFollowerId = 0;
        }
        continue;
      }

      const type = u.type === "group" ? "group" : "profile";
      const base = Number(u.baseFollowers ?? 0);
      const gainedToday = Number(u.gainedToday ?? 0);
      const tracking = Boolean(u.tracking ?? false);
      const robloxId = Number(u.robloxId ?? 0);

      migrated[uid] = {
        discordId: String(u.discordId ?? uid),
        targets: {
          profile:
            type === "profile"
              ? {
                  tracking,
                  robloxId,
                  username: u.username ?? "Desconhecido",
                  baseTotal: base,
                  gainedToday,
                  lastUpdate: Number(u.lastUpdate ?? Date.now()),
                  lastFollowerId: 0
                }
              : {
                  tracking: false,
                  robloxId: 0,
                  username: "Desconhecido",
                  baseTotal: 0,
                  gainedToday: 0,
                  lastUpdate: Date.now(),
                  lastFollowerId: 0
                },

          group:
            type === "group"
              ? {
                  tracking,
                  robloxId,
                  username: u.username ?? "Grupo",
                  baseTotal: base,
                  gainedToday,
                  lastUpdate: Number(u.lastUpdate ?? Date.now())
                }
              : {
                  tracking: false,
                  robloxId: 0,
                  username: "Grupo",
                  baseTotal: 0,
                  gainedToday: 0,
                  lastUpdate: Date.now()
                }
        },
        history: u.history || {}
      };
    }

    return migrated;
  } catch (e) {
    console.error("❌ Erro lendo data.json:", e);
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let usersData = loadData();

/* ================= HELPERS (MODELO NOVO) ================= */
function ensureUser(discordId) {
  const id = String(discordId);

  if (!usersData[id] || typeof usersData[id] !== "object") {
    usersData[id] = {
      discordId: id,
      targets: {
        profile: {
          tracking: false,
          robloxId: 0,
          username: "Desconhecido",
          baseTotal: 0,
          gainedToday: 0,
          lastUpdate: Date.now(),
          lastFollowerId: 0
        },
        group: {
          tracking: false,
          robloxId: 0,
          username: "Grupo",
          baseTotal: 0,
          gainedToday: 0,
          lastUpdate: Date.now()
        }
      },
      history: {}
    };
    saveData(usersData);
  }

  if (!usersData[id].targets) {
    usersData[id].targets = {
      profile: {
        tracking: false,
        robloxId: 0,
        username: "Desconhecido",
        baseTotal: 0,
        gainedToday: 0,
        lastUpdate: Date.now(),
        lastFollowerId: 0
      },
      group: {
        tracking: false,
        robloxId: 0,
        username: "Grupo",
        baseTotal: 0,
        gainedToday: 0,
        lastUpdate: Date.now()
      }
    };
  }

  if (!usersData[id].targets.profile) {
    usersData[id].targets.profile = {
      tracking: false,
      robloxId: 0,
      username: "Desconhecido",
      baseTotal: 0,
      gainedToday: 0,
      lastUpdate: Date.now(),
      lastFollowerId: 0
    };
  }

  if (!usersData[id].targets.group) {
    usersData[id].targets.group = {
      tracking: false,
      robloxId: 0,
      username: "Grupo",
      baseTotal: 0,
      gainedToday: 0,
      lastUpdate: Date.now()
    };
  }

  if (usersData[id].targets.profile.lastFollowerId == null) {
    usersData[id].targets.profile.lastFollowerId = 0;
  }

  if (!usersData[id].history) usersData[id].history = {};
  return usersData[id];
}

function getTarget(discordId, type /* "profile" | "group" */) {
  const u = ensureUser(discordId);
  return u.targets[type];
}

/* ================= BD (ATIVO, SEM QUEBRAR SE FALHAR) ================= */
async function safeDbRun(sql, params = []) {
  if (!db || typeof db.run !== "function") return;
  try {
    await db.run(sql, params);
  } catch (e) {
    log(`DB run falhou: ${e.message}`, "WARN");
  }
}

async function safeDbAll(sql, params = []) {
  if (!db) return [];
  try {
    if (typeof db.all === "function") return await db.all(sql, params);
    if (typeof db.prepare === "function") {
      const stmt = await db.prepare(sql);
      return await stmt.all(params);
    }
  } catch (e) {
    log(`DB all falhou: ${e.message}`, "WARN");
  }
  return [];
}

async function ensureTargetsTable() {
  await safeDbRun(`
    CREATE TABLE IF NOT EXISTS targets (
      discord_id TEXT NOT NULL,
      type TEXT NOT NULL,
      roblox_id TEXT NOT NULL,
      username TEXT,
      total INTEGER DEFAULT 0,
      gained_today INTEGER DEFAULT 0,
      tracking INTEGER DEFAULT 0,
      last_update INTEGER DEFAULT 0,
      last_follower_id INTEGER DEFAULT 0,
      PRIMARY KEY (discord_id, type)
    )
  `);
}

async function upsertTargetToDB(discordId, type, t) {
  if (!db) return;
  await ensureTargetsTable();
  await safeDbRun(
    `INSERT OR REPLACE INTO targets
     (discord_id, type, roblox_id, username, total, gained_today, tracking, last_update, last_follower_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(discordId),
      String(type),
      String(t.robloxId ?? 0),
      String(t.username ?? ""),
      Number(t.baseTotal ?? 0),
      Number(t.gainedToday ?? 0),
      t.tracking ? 1 : 0,
      Number(t.lastUpdate ?? Date.now()),
      Number(type === "profile" ? (t.lastFollowerId ?? 0) : 0)
    ]
  );
}

async function syncTargetsFromDB() {
  if (!db) return;
  await ensureTargetsTable();

  const rows = await safeDbAll(`SELECT * FROM targets`, []);
  if (!Array.isArray(rows) || rows.length === 0) {
    log("BD: tabela targets vazia (ok).", "INFO");
    return;
  }

  for (const r of rows) {
    const discordId = String(r.discord_id ?? "");
    const type = String(r.type ?? "");
    if (!discordId || (type !== "profile" && type !== "group")) continue;

    const u = ensureUser(discordId);
    u.targets[type] = {
      tracking: Boolean(r.tracking),
      robloxId: Number(r.roblox_id ?? 0),
      username: r.username ?? (type === "group" ? "Grupo" : "Desconhecido"),
      baseTotal: Number(r.total ?? 0),
      gainedToday: Number(r.gained_today ?? 0),
      lastUpdate: Number(r.last_update ?? Date.now()),
      ...(type === "profile" ? { lastFollowerId: Number(r.last_follower_id ?? 0) } : {})
    };
  }

  saveData(usersData);
  log(`✅ BD -> JSON (targets) sync: ${rows.length} registros`, "SUCCESS");
}

function setTarget(discordId, type, payload) {
  const u = ensureUser(discordId);

  const prev = u.targets[type] || {};
  const baseObj = {
    tracking: Boolean(payload.tracking),
    robloxId: Number(payload.robloxId ?? 0),
    username: payload.username ?? (type === "group" ? "Grupo" : "Desconhecido"),
    baseTotal: Number(payload.baseTotal ?? 0),
    gainedToday: Number(payload.gainedToday ?? 0),
    lastUpdate: Number(payload.lastUpdate ?? Date.now())
  };

  if (type === "profile") {
    baseObj.lastFollowerId =
      payload.lastFollowerId != null
        ? Number(payload.lastFollowerId || 0)
        : Number(prev.lastFollowerId || 0);
  }

  u.targets[type] = baseObj;
  saveData(usersData);

  upsertTargetToDB(discordId, type, u.targets[type]).catch(() => {});
  return u.targets[type];
}

/* ================= ROBLOX: RATE LIMIT GLOBAL + RETRY/BACKOFF ================= */
const ROBLOX_MIN_DELAY_MS = 650; // mais alto = menos 429
let _robloxQueue = Promise.resolve();
let _lastRobloxReqAt = 0;

function robloxEnqueue(fn) {
  _robloxQueue = _robloxQueue.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, ROBLOX_MIN_DELAY_MS - (now - _lastRobloxReqAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    _lastRobloxReqAt = Date.now();
    return fn();
  });
  return _robloxQueue;
}

async function fetchWithRetry(url, options = {}, maxRetries = 6) {
  let attempt = 0;
  let waitMs = 900;

  while (true) {
    attempt++;
    try {
      const res = await robloxEnqueue(() => fetch(url, options));

      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const serverWait = retryAfter ? Number(retryAfter) * 1000 : 0;
        const jitter = Math.floor(Math.random() * 250);
        const finalWait = Math.max(waitMs, serverWait) + jitter;

        log(`⚠️ Roblox HTTP 429 (RATE LIMIT) | url=${url} | retry ${attempt}/${maxRetries} em ${finalWait}ms`, "WARN");

        if (attempt >= maxRetries) {
          log(`❌ Roblox 429: desisti após ${maxRetries} tentativas | url=${url}`, "ERROR");
          throw new Error(`HTTP 429 após ${maxRetries} tentativas`);
        }

        await new Promise((r) => setTimeout(r, finalWait));
        waitMs = Math.min(waitMs * 2, 20_000);
        continue;
      }

      if (res.status >= 500 && res.status <= 599) {
        const jitter = Math.floor(Math.random() * 250);
        const finalWait = waitMs + jitter;

        log(`⚠️ Roblox HTTP ${res.status} | url=${url} | retry ${attempt}/${maxRetries} em ${finalWait}ms`, "WARN");

        if (attempt >= maxRetries) {
          log(`❌ Roblox HTTP ${res.status}: desisti após ${maxRetries} tentativas | url=${url}`, "ERROR");
          throw new Error(`HTTP ${res.status} após ${maxRetries} tentativas`);
        }

        await new Promise((r) => setTimeout(r, finalWait));
        waitMs = Math.min(waitMs * 2, 20_000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        log(`❌ Roblox HTTP ${res.status} | url=${url} | body=${text.slice(0, 120)}`, "ERROR");
        throw new Error(`HTTP ${res.status} | ${text.slice(0, 120)}`);
      }

      return res;
    } catch (err) {
      if (attempt >= maxRetries) {
        log(`❌ fetch falhou (final) | url=${url} | ${err.message}`, "ERROR");
        throw err;
      }

      const jitter = Math.floor(Math.random() * 250);
      const finalWait = waitMs + jitter;

      log(`⚠️ fetch falhou | url=${url} | ${err.message} | retry ${attempt}/${maxRetries} em ${finalWait}ms`, "WARN");
      await new Promise((r) => setTimeout(r, finalWait));
      waitMs = Math.min(waitMs * 2, 20_000);
    }
  }
}

/* ================= ROBLOX HELPERS + CACHE ================= */
const usernameCache = new Map();
const groupCache = new Map();

const tickCache = new Map();
const TICK_CACHE_TTL_MS = 55_000;

function tickGet(key) {
  const v = tickCache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > TICK_CACHE_TTL_MS) {
    tickCache.delete(key);
    return null;
  }
  return v.value;
}
function tickSet(key, value) {
  tickCache.set(key, { value, ts: Date.now() });
}

const robloxProfileCache = new Map();
const ROBLOX_PROFILE_CACHE_TTL_MS = 45_000;

function cacheGetProfile(key) {
  const it = robloxProfileCache.get(key);
  if (!it) return null;
  if (Date.now() > it.exp) {
    robloxProfileCache.delete(key);
    return null;
  }
  return it.embedJson;
}
function cacheSetProfile(key, embed) {
  robloxProfileCache.set(key, { embedJson: embed.toJSON(), exp: Date.now() + ROBLOX_PROFILE_CACHE_TTL_MS });
}

async function getFollowersCount(userId, { force = false } = {}) {
  const k = `followersCount:${userId}`;

  if (force) tickCache.delete(k);

  const cached = tickGet(k);
  if (!force && cached != null) return cached;

  const res = await fetchWithRetry(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
  const data = await res.json();
  const count = Number(data.count ?? 0);

  tickSet(k, count);
  return count;
}

async function getRobloxUsername(userId) {
  const cached = usernameCache.get(userId);
  if (cached && cached.exp > Date.now()) return cached.name;

  const res = await fetchWithRetry(`https://users.roblox.com/v1/users/${userId}`);
  const data = await res.json();
  const name = data.name || "Desconhecido";

  usernameCache.set(userId, { name, exp: Date.now() + 6 * 60 * 60 * 1000 });
  return name;
}

async function getGroupInfo(groupId) {
  const cached = groupCache.get(groupId);
  if (cached && cached.exp > Date.now()) return { name: cached.name, memberCount: cached.memberCount };

  const res = await fetchWithRetry(`https://groups.roblox.com/v1/groups/${groupId}`);
  const data = await res.json();
  const info = {
    name: data.name || "Grupo",
    memberCount: Number(data.memberCount ?? 0)
  };

  groupCache.set(groupId, { ...info, exp: Date.now() + 10 * 60 * 1000 });
  return info;
}

async function getCurrentTotalByType(type, robloxId) {
  if (type === "group") {
    const info = await getGroupInfo(robloxId);
    return { total: info.memberCount, username: info.name };
  }
  const total = await getFollowersCount(robloxId);
  const username = await getRobloxUsername(robloxId).catch(() => "Desconhecido");
  return { total, username };
}

/* ================= DETECÇÃO ROBUSTA (PERFIS GRANDES) ================= */
async function getFollowersPage(userId, cursor = "", limit = 100) {
  const url =
    `https://friends.roblox.com/v1/users/${userId}/followers` +
    `?limit=${limit}&cursor=${encodeURIComponent(cursor)}&sortOrder=Desc`;

  const res = await fetchWithRetry(url);
  const data = await res.json();
  return {
    list: Array.isArray(data?.data) ? data.data : [],
    nextCursor: data?.nextPageCursor || ""
  };
}

async function getLatestFollowerId(userId) {
  const { list } = await getFollowersPage(userId, "", 10);
  const first = list[0];
  const fid = Number(first?.id ?? first?.userId ?? 0);
  return Number.isFinite(fid) ? fid : 0;
}

async function detectProfileGainsByListPaged(t, maxPages = 6) {
  const lastId = Number(t.lastFollowerId || 0);

  let cursor = "";
  let pages = 0;
  let gained = 0;
  let newestId = 0;

  while (pages < maxPages) {
    pages++;
    const { list, nextCursor } = await getFollowersPage(t.robloxId, cursor, 100);

    if (!list.length) {
      return { gained: 0, newLastId: lastId || 0, pages };
    }

    if (pages === 1) {
      newestId = Number(list[0]?.id ?? list[0]?.userId ?? 0) || 0;

      // primeira vez: inicializa lastFollowerId sem notificar
      if (!lastId) return { gained: 0, newLastId: newestId, pages };

      // não mudou
      if (newestId === lastId) return { gained: 0, newLastId: lastId, pages };
    }

    for (const f of list) {
      const fid = Number(f?.id ?? f?.userId ?? 0) || 0;
      if (fid === lastId) {
        return { gained, newLastId: newestId, pages };
      }
      gained++;
    }

    if (!nextCursor) break;
    cursor = nextCursor;

    // mini pausa pra reduzir 429
    await new Promise((r) => setTimeout(r, 200));
  }

  // não achou o lastId => veio MUITO seguidor; atualiza pro newest e notifica gained contado
  return { gained, newLastId: newestId, pages };
}

/* ================= /ROBLOX (USERNAME ONLY) ================= */
function formatRelativeDate(dateStr) {
  const ms = Date.parse(dateStr);
  if (!Number.isFinite(ms)) return { ts: null, text: "—" };
  const ts = Math.floor(ms / 1000);
  return { ts, text: `<t:${ts}:D> • <t:${ts}:R>` };
}

async function resolveRobloxUserByUsername(username) {
  const name = String(username || "").trim();
  if (!name) throw new Error("Informe username");

  const body = { usernames: [name], excludeBannedUsers: false };

  const res = await fetchWithRetry(`https://users.roblox.com/v1/usernames/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  const u = Array.isArray(data?.data) ? data.data[0] : null;
  if (!u?.id) throw new Error("Usuário não encontrado");

  const res2 = await fetchWithRetry(`https://users.roblox.com/v1/users/${u.id}`);
  const data2 = await res2.json();

  return {
    id: Number(data2.id),
    name: data2.name,
    displayName: data2.displayName,
    description: data2.description,
    created: data2.created
  };
}

async function getCountsSerial(userId) {
  const friends = await fetchWithRetry(`https://friends.roblox.com/v1/users/${userId}/friends/count`)
    .then((r) => r.json())
    .then((j) => Number(j.count ?? 0))
    .catch(() => 0);

  await new Promise((r) => setTimeout(r, 120));

  const followers = await fetchWithRetry(`https://friends.roblox.com/v1/users/${userId}/followers/count`)
    .then((r) => r.json())
    .then((j) => Number(j.count ?? 0))
    .catch(() => 0);

  await new Promise((r) => setTimeout(r, 120));

  const following = await fetchWithRetry(`https://friends.roblox.com/v1/users/${userId}/followings/count`)
    .then((r) => r.json())
    .then((j) => Number(j.count ?? 0))
    .catch(() => 0);

  return { friends, followers, following };
}

async function getPresenceText(userId) {
  try {
    const res = await fetchWithRetry(`https://presence.roblox.com/v1/presence/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIds: [Number(userId)] })
    });

    const data = await res.json();
    const u = Array.isArray(data?.userPresences) ? data.userPresences[0] : null;
    const type = Number(u?.userPresenceType ?? 0);

    if (type === 2) return "🟢 In-Game";
    if (type === 3) return "🟠 In-Studio";
    if (type === 1) return "🟡 Online";
    return "⚫ Offline";
  } catch {
    return "—";
  }
}

async function getAvatarThumb(userId) {
  const trySizes = ["720x720", "420x420"];
  for (const size of trySizes) {
    try {
      const res = await fetchWithRetry(
        `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=${size}&format=Png&isCircular=false`
      );
      const data = await res.json();
      const item = Array.isArray(data?.data) ? data.data[0] : null;
      if (item?.imageUrl) return item.imageUrl;
    } catch {}
  }
  return null;
}

async function getUserGroupsTotal(userId) {
  try {
    const res = await fetchWithRetry(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
    const data = await res.json();
    const groups = Array.isArray(data?.data) ? data.data : [];
    return groups.length;
  } catch {
    return 0;
  }
}

async function getPastNames(userId) {
  try {
    const res = await fetchWithRetry(
      `https://users.roblox.com/v1/users/${userId}/username-history?limit=10&sortOrder=Desc`
    );
    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    const names = list.map((x) => x?.name).filter(Boolean);
    return names.length ? names.slice(0, 5).map((n) => `\`${n}\``).join(" ") : "—";
  } catch {
    return "—";
  }
}

async function buildRobloxProfileEmbedByUsername(username) {
  const unameKey = String(username || "").trim().toLowerCase();
  const cacheKey = `u:${unameKey}`;

  const cached = cacheGetProfile(cacheKey);
  if (cached) return EmbedBuilder.from(cached);

  const user = await resolveRobloxUserByUsername(username);

  const counts = await getCountsSerial(user.id).catch(() => ({ friends: 0, followers: 0, following: 0 }));
  await new Promise((r) => setTimeout(r, 120));

  const status = await getPresenceText(user.id).catch(() => "—");
  await new Promise((r) => setTimeout(r, 120));

  const avatarUrl = await getAvatarThumb(user.id).catch(() => null);
  await new Promise((r) => setTimeout(r, 120));

  const groupsTotal = await getUserGroupsTotal(user.id).catch(() => 0);
  await new Promise((r) => setTimeout(r, 120));

  const pastNames = await getPastNames(user.id).catch(() => "—");

  const created = formatRelativeDate(user.created);

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setAuthor({ name: `${user.name} (${user.displayName || user.name})` })
    .addFields(
      { name: "🆔 ID", value: `\`${user.id}\``, inline: true },
      { name: "📅 Created", value: created.text, inline: true },
      { name: "🟢 Status", value: `${status}`, inline: true },
      { name: "🤝 Friends", value: `\`${counts.friends.toLocaleString()}\``, inline: true },
      { name: "👥 Followers", value: `\`${counts.followers.toLocaleString()}\``, inline: true },
      { name: "➡️ Following", value: `\`${counts.following.toLocaleString()}\``, inline: true },
      { name: "🏠 Groups", value: `\`${Number(groupsTotal || 0).toLocaleString()}\``, inline: true },
      { name: "📝 Past Names", value: pastNames, inline: false },
      {
        name: "📌 Description",
        value: user.description?.length ? `\`\`\`\n${user.description.slice(0, 220)}\n\`\`\`` : "—",
        inline: false
      }
    )
    .setFooter({ text: `Requested by username • ${user.name}` })
    .setTimestamp();

  if (avatarUrl) embed.setImage(avatarUrl);

  cacheSetProfile(cacheKey, embed);
  return embed;
}

/* ================= EMBEDS ================= */
function progressBar(percent) {
  const total = 10;
  const filled = Math.round((percent / 100) * total);
  return "█".repeat(filled) + "░".repeat(total - filled);
}

function changeEmbed({ title, username, gained, today, total }) {
  return new EmbedBuilder()
    .setTitle(title || "📈 Mudança detectada!")
    .setColor(0xff2d7a)
    .addFields(
      { name: "👤 User", value: `\`${username}\``, inline: true },
      { name: "🆕 Novos", value: `\`\`\`diff\n+ ${gained}\n\`\`\``, inline: true },
      { name: "📅 Hoje", value: `\`\`\`diff\n+ ${today}\n\`\`\``, inline: true },
      { name: "📊 Estimativa Total", value: `\`\`\`\n${Number(total).toLocaleString()}\n\`\`\``, inline: false }
    )
    .setFooter({ text: "Roblox Follower Tracker" })
    .setTimestamp();
}

/* ================= HISTÓRICO DIÁRIO ================= */
function saveDailyHistory(discordId, type, total) {
  const today = new Date().toISOString().slice(0, 10);
  const u = ensureUser(discordId);
  if (!u.history) u.history = {};
  if (!u.history[today]) u.history[today] = {};
  u.history[today][type] = Number(total ?? 0);
  saveData(usersData);
}

/* ===== CONTAR SEGUIDORES COM PROGRESSO (só para profile) ===== */
async function contarSeguidoresComProgresso(robloxUserId, interaction, { expectedTotal = 0 } = {}) {
  // ✅ 1) Começa com o total REAL salvo (do seu bot)
  let totalEsperado = Number(expectedTotal || 0);

  // ✅ 2) Se não tiver nada salvo ainda, usa count do Roblox só como fallback
  if (!Number.isFinite(totalEsperado) || totalEsperado <= 0) {
    totalEsperado = await getFollowersCount(robloxUserId, { force: true }).catch(() => 0);
  }

  let cursor = "";
  let totalContado = 0;
  let paginas = 0;
  const startTime = Date.now();

  while (true) {
    const res = await fetchWithRetry(
      `https://friends.roblox.com/v1/users/${robloxUserId}/followers?limit=100&cursor=${encodeURIComponent(cursor)}`
    );

    const data = await res.json();
    totalContado += data.data?.length ?? 0;
    paginas++;
    if (totalContado > totalEsperado) totalEsperado = totalContado;

    const percent = totalEsperado > 0 ? Math.min(100, Math.floor((totalContado / totalEsperado) * 100)) : 100;

    const elapsed = (Date.now() - startTime) / 1000;
    const avgPerPage = elapsed / paginas;

    const totalPages = Math.max(1, Math.ceil(totalEsperado / 100));
    const remainingPages = Math.max(0, totalPages - paginas);
    const eta = Math.max(0, Math.round(remainingPages * avgPerPage));

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("⏳ Recontando seguidores...")
      .addFields(
        { name: "Progresso", value: `${progressBar(percent)} **${percent}%**`, inline: false },
        {
          name: "Seguidores",
          value: `👥 \` ${totalContado.toLocaleString()} / ${Number(totalEsperado || 0).toLocaleString()} \``,
          inline: false
        },
        { name: "Páginas", value: `📄 \` ${paginas}/${totalPages} \``, inline: true },
        { name: "Tempo restante", value: `⏱️ \` ~${eta}s \``, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], content: "" });

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;

    await new Promise((r) => setTimeout(r, 150));
  }

  // ✅ No final: deixa “fixo” com o TOTAL REAL
  const finalEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Recontagem concluída")
    .addFields(
      { name: "Total real", value: `👥 \`${totalContado.toLocaleString()}\``, inline: false },
      { name: "Páginas", value: `📄 \`${paginas}\``, inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [finalEmbed], content: "" });

  return { totalContado, paginas };
}

/* ================= SLASH COMMANDS ================= */
const commands = [
  new SlashCommandBuilder().setName("painel").setDescription("Abrir painel do Roblox Tracker"),
  new SlashCommandBuilder()
    .setName("roblox")
    .setDescription("Ver perfil Roblox (somente username)")
    .addStringOption((o) => o.setName("username").setDescription("Nome do usuário Roblox").setRequired(true)),
  new SlashCommandBuilder().setName("reset").setDescription("Reiniciar o bot (apenas dono)")
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

/* ================= READY ================= */
client.once("clientReady", async () => {
  try {
    await initDB();
    db = getDB();
    log("✅ Banco de dados carregado", "SUCCESS");

    await syncTargetsFromDB();

    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    log(`✅ Comandos registrados (${commands.length})`, "SUCCESS");

    log(`✅ Bot online como ${client.user.tag}`, "SUCCESS");

    //AVISO AUTOMÁTICO APÓS RESET / START
    try {
      const owner = await client.users.fetch(OWNER_ID);
      await owner.send("✅ Estou online novamente.");
      log("DM de online enviada ao dono", "EVENT");
    } catch {
      log("Não consegui enviar DM de online ao dono", "WARN");
    }

    const statuses = [
      { name: "Roblox Tracker", type: 0 },
      { name: "/perfil na DM", type: 0 },
      { name: "Seguidores + Grupos", type: 0 },
      { name: "/painel na DM", type: 0 }
    ];

    let i = 0;
    setInterval(() => {
      client.user.setPresence({
        activities: [statuses[i]],
        status: "dnd"
      });
      i = (i + 1) % statuses.length;
    }, 2500);
  } catch (err) {
    log(`Erro no ready: ${err?.stack || err?.message || err}`, "ERROR");
  }
});

/* ================= INTERAÇÕES ================= */
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) log(`Slash /${interaction.commandName} por ${interaction.user.tag}`, "EVENT");
    if (interaction.isButton()) log(`Botão ${interaction.customId} por ${interaction.user.tag}`, "EVENT");
    if (interaction.isModalSubmit()) log(`Modal ${interaction.customId} por ${interaction.user.tag}`, "EVENT");
    if (interaction.isStringSelectMenu()) log(`Select ${interaction.customId} por ${interaction.user.tag}`, "EVENT");

    // ========== SLASH ==========
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "painel") {
        if (interaction.guild) {
          return interaction.reply({ content: "❌ Use este comando no **privado do bot**.", flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
          .setTitle("📊 Roblox Tracker")
          .setDescription(

            "```" +
            "• Acompanhe as mudanças nos seus seguidores do Roblox e grupo em tempo real.\n" +
            "• Todas as atualizações são enviadas diretamente para suas mensagens diretas." +
            "```\n" +
              "## 📌 Funções:\n" +
              "• 👤 **Track Profile** – rastrear perfil\n" +
              "• 👥 **Track Group** – rastrear grupo\n" +
              "• 🔄 **Update Estimate** – recontar (perfil/grupo)\n" +
              "• 📈 **Status** – ver os ativos\n" +
              "• ⛔ **Untrack** – parar um ou ambos\n\n" +
              "🔎 • **Extra:** use `/perfil` para ver o perfil."
          )
          .setColor(0xe74c3c)
          .setFooter({ text: "Atualização automática a cada 5 minuto" })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("track_profile").setLabel("Track Profile").setEmoji("👤").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("track_group").setLabel("Track Group").setEmoji("👥").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("update_estimate").setLabel("Update Estimate").setEmoji("🔄").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("status").setLabel("Status").setEmoji("📊").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("untrack_menu").setLabel("Untrack").setEmoji("⛔").setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({ embeds: [embed], components: [row] });
      }

      if (interaction.commandName === "perfil") {
        const username = interaction.options.getString("username");
        if (!username) return interaction.reply({ content: "❌ Use `/perfil username:<nome>`", flags: MessageFlags.Ephemeral });

        await interaction.reply({ content: "⏳ Buscando perfil no Roblox...", flags: MessageFlags.Ephemeral });

        try {
          const embed = await buildRobloxProfileEmbedByUsername(username);
          return interaction.editReply({ content: "", embeds: [embed] });
        } catch (e) {
          log(`Erro /perfil username: ${e?.stack || e?.message || e}`, "ERROR");
          return interaction.editReply({
            content: "❌ Não consegui buscar esse usuário. Verifique o **username** e tente de novo."
          });
        }
      }

      if (interaction.commandName === "reset") {
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({ content: "❌ Você não tem permissão.", flags: MessageFlags.Ephemeral });
        }
        await interaction.reply({ content: "🔄 Reiniciando o bot...", flags: MessageFlags.Ephemeral });
        log("Reset via slash /reset", "WARN");
        setTimeout(() => process.exit(0), 1200);
      }
    }

    // ========== BOTÕES ==========
    if (interaction.isButton()) {
      const userId = interaction.user.id;
      const u = ensureUser(userId);

      if (interaction.customId === "track_profile" || interaction.customId === "track_group") {
        const isGroup = interaction.customId === "track_group";

        const modal = new ModalBuilder()
          .setCustomId(isGroup ? "track_modal_group" : "track_modal_profile")
          .setTitle(isGroup ? "Rastrear Grupo Roblox" : "Rastrear Perfil Roblox");

        const input = new TextInputBuilder()
          .setCustomId("roblox_id")
          .setLabel(isGroup ? "ID do Grupo Roblox" : "ID do Perfil Roblox")
          .setPlaceholder(isGroup ? "Ex: 123456" : "Ex: 123456789")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === "untrack_menu") {
        const menu = new StringSelectMenuBuilder()
          .setCustomId("untrack_select")
          .setPlaceholder("Escolha o que parar de rastrear...")
          .addOptions(
            { label: "Parar Perfil (Seguidores)", value: "profile", description: "Desativa apenas o tracker de seguidores" },
            { label: "Parar Grupo (Membros)", value: "group", description: "Desativa apenas o tracker de membros do grupo" },
            { label: "Parar Ambos", value: "both", description: "Desativa perfil e grupo" }
          );

        const row = new ActionRowBuilder().addComponents(menu);

        return interaction.reply({ content: "🛑 O que você quer parar de rastrear?", components: [row], flags: MessageFlags.Ephemeral });
      }

      if (interaction.customId === "status") {
        const p = getTarget(userId, "profile");
        const g = getTarget(userId, "group");

        const fields = [];

        if (p?.tracking && Number(p.robloxId) > 0) {
          const last = p.lastUpdate ? `<t:${Math.floor(Number(p.lastUpdate) / 1000)}:R>` : "`-`";
          fields.push({
            name: "👤 Perfil (Seguidores)",
            value:
              `**User:** \` ${p.username} \`\n` +
              `🆔 **ID:** \` ${p.robloxId} \`\n` +
              `👥 **Total:** \` ${Number(p.baseTotal).toLocaleString()} \`\n` +
              `📈 **Hoje:** \` +${Number(p.gainedToday).toLocaleString()} \`\n` +
              `⏱️ **Atualizado:** ${last}\n\n\n`,
            inline: false
          });
        }

        if (g?.tracking && Number(g.robloxId) > 0) {
          const last = g.lastUpdate ? `<t:${Math.floor(Number(g.lastUpdate) / 1000)}:R>` : "`-`";
          fields.push({
            name: "👥 Grupo (Membros)",
            value:
              `**User:** \` ${g.username} \`\n` +
              `🆔 **ID:** \` ${g.robloxId} \`\n` +
              `👥 **Total:** \` ${Number(g.baseTotal).toLocaleString()} \`\n` +
              `📈 **Hoje:** \` +${Number(g.gainedToday).toLocaleString()} \`\n` +
              `⏱️ **Atualizado:** ${last}\n`,
            inline: false
          });
        }

        if (!fields.length) fields.push({ name: "Nenhum tracker ativo", value: "Use `/painel` para configurar.", inline: false });

        const embed = new EmbedBuilder()
          .setTitle("📊 Status do Rastreador")
          .setColor(0x57f287)
          .addFields(fields)
          .setFooter({ text: "Roblox Tracker • Atualização automática ativa" })
          .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      if (interaction.customId === "update_estimate") {
        const lockKey = userId;
        if (runningEstimates.has(lockKey)) {
          return interaction.reply({ content: "⏳ Já estou contando, aguarde.", flags: MessageFlags.Ephemeral });
        }

        const p = u.targets.profile;
        const g = u.targets.group;

        const pOn = p?.tracking && Number(p.robloxId) > 0;
        const gOn = g?.tracking && Number(g.robloxId) > 0;

        if (!pOn && !gOn) {
          return interaction.reply({
            content: "❌ Você não tem tracker ativo (perfil/grupo).",
            flags: MessageFlags.Ephemeral
          });
        }

        runningEstimates.add(lockKey);
        log(`Update Estimate iniciado (pOn=${!!pOn}, gOn=${!!gOn}) por ${interaction.user.tag}`, "EVENT");

        const loadingEmbed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle("⏳ Iniciando recontagem")
          .setDescription("Vou atualizar **Perfil** e/ou **Grupo** que estiverem ativos.")
          .setTimestamp();

        await interaction.reply({ embeds: [loadingEmbed], flags: MessageFlags.Ephemeral });

        try {
          const fields = [];

          // GROUP
          if (gOn) {
            const info = await getGroupInfo(g.robloxId);
            g.username = info.name;
            g.baseTotal = info.memberCount;
            g.lastUpdate = Date.now();

            saveData(usersData);
            saveDailyHistory(userId, "group", info.memberCount);
            await upsertTargetToDB(userId, "group", g);

            fields.push(
              { name: "👥 Grupo", value: `\`${info.name}\``, inline: false },
              { name: "📊 Membros atuais", value: `\`${info.memberCount.toLocaleString()}\``, inline: true }
            );

            log(`Recontagem grupo OK: ${info.name} = ${info.memberCount}`, "SUCCESS");
          }

          // PROFILE
          if (pOn) {
            const oldSaved = Number(p.baseTotal ?? 0);

            // ✅ conta e mostra progresso (TOTAL REAL é o totalContado)
            const result = await contarSeguidoresComProgresso(p.robloxId, interaction, {
              expectedTotal: oldSaved
            });

            const newTotal = Number(result?.totalContado ?? 0);

            // ✅ CORREÇÃO: define uname aqui (antes de usar)
            const uname = await getRobloxUsername(p.robloxId).catch(() => p.username);

            p.username = uname || p.username;
            p.baseTotal = newTotal;
            p.lastUpdate = Date.now();

            const newestId = await getLatestFollowerId(p.robloxId).catch(() => 0);
            if (newestId) p.lastFollowerId = newestId;

            const lost = oldSaved > newTotal ? oldSaved - newTotal : 0;

            saveData(usersData);
            saveDailyHistory(userId, "profile", newTotal);
            await upsertTargetToDB(userId, "profile", p);

            fields.push(
              { name: "👤 Perfil", value: `\`${p.username}\``, inline: false },
              { name: "📊 Seguidores contados", value: `\`${newTotal.toLocaleString()}\``, inline: true },
              { name: "📄 Páginas analisadas", value: `\`${result.paginas}\``, inline: true }
            );

            if (lost > 0) {
              fields.push({ name: "📉 Perdeu", value: `\`-${lost.toLocaleString()}\``, inline: true });
            }

            log(`Recontagem perfil OK: ${p.username} = ${newTotal} (lost=${lost})`, "SUCCESS");
          }

          const doneEmbed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("✅ Recontagem concluída")
            .addFields(fields)
            .setTimestamp();

          await interaction.editReply({ embeds: [doneEmbed], content: "" });
        } catch (err) {
          log(`Erro no update_estimate: ${err?.stack || err?.message || err}`, "ERROR");

          const errorEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Erro na recontagem")
            .setDescription("Não consegui atualizar os dados.\nTente novamente em alguns segundos.")
            .setTimestamp();

          await interaction.editReply({ embeds: [errorEmbed], content: "" });
        } finally {
          runningEstimates.delete(lockKey);
        }
      }
    }

    // ========== SELECT MENU ==========
    if (interaction.isStringSelectMenu() && interaction.customId === "untrack_select") {
      const userId = interaction.user.id;
      const u = ensureUser(userId);
      const choice = interaction.values?.[0];

      const stopped = [];

      if (choice === "profile" || choice === "both") {
        u.targets.profile.tracking = false;
        u.targets.profile.lastUpdate = Date.now();
        await upsertTargetToDB(userId, "profile", u.targets.profile);
        stopped.push("👤 Perfil (Seguidores)");
      }

      if (choice === "group" || choice === "both") {
        u.targets.group.tracking = false;
        u.targets.group.lastUpdate = Date.now();
        await upsertTargetToDB(userId, "group", u.targets.group);
        stopped.push("👥 Grupo (Membros)");
      }

      saveData(usersData);
      log(`Untrack seletivo (${choice}) por ${interaction.user.tag}`, "WARN");

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("🛑 Rastreamento desativado")
        .setDescription(stopped.length ? stopped.join("\n") : "Nada foi alterado.")
        .setFooter({ text: "Roblox Tracker" })
        .setTimestamp();

      return interaction.update({ content: "", embeds: [embed], components: [] });
    }

    // ========== MODAIS ==========
    if (
      interaction.isModalSubmit() &&
      (interaction.customId === "track_modal_profile" || interaction.customId === "track_modal_group")
    ) {
      const robloxIdRaw = interaction.fields.getTextInputValue("roblox_id").trim();
      const robloxId = Number(robloxIdRaw);

      if (!Number.isFinite(robloxId) || robloxId <= 0) {
        return interaction.reply({ content: "❌ ID inválido. Use apenas números.", flags: MessageFlags.Ephemeral });
      }

      const userId = interaction.user.id;
      ensureUser(userId);

      const isGroup = interaction.customId === "track_modal_group";
      await interaction.reply({ content: "⏳ Buscando informações do Roblox...", flags: MessageFlags.Ephemeral });

      try {
        let username;
        let total;
        let type;

        if (isGroup) {
          const info = await getGroupInfo(robloxId);
          username = info.name;
          total = info.memberCount;
          type = "group";
        } else {
          username = await getRobloxUsername(robloxId);
          total = await getFollowersCount(robloxId);
          type = "profile";
        }

        const payload = {
          tracking: true,
          robloxId,
          username,
          baseTotal: total,
          gainedToday: 0,
          lastUpdate: Date.now()
        };

        if (type === "profile") {
          const newestId = await getLatestFollowerId(robloxId).catch(() => 0);
          payload.lastFollowerId = newestId || 0;
        }

        const t = setTarget(userId, type, payload);

        saveDailyHistory(userId, type, total);
        await upsertTargetToDB(userId, type, t);

        log(`Tracker ativado (${type}) => ${username} (${robloxId}) por ${interaction.user.tag}`, "SUCCESS");

        const successEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("✅ Rastreamento iniciado!")
          .addFields(
            { name: "🎯 Tipo", value: `\`${type === "group" ? "Grupo (membros)" : "Perfil (seguidores)"}\``, inline: false },
            { name: "👤 Alvo", value: `\`${username}\``, inline: false },
            { name: "📊 Total atual", value: `\`${total.toLocaleString()}\``, inline: false }
          )
          .setFooter({ text: "Você pode ativar o outro também via /painel." })
          .setTimestamp();

        return interaction.editReply({ embeds: [successEmbed], content: "" });
      } catch (err) {
        log(`Erro ao iniciar tracking: ${err?.stack || err?.message || err}`, "ERROR");

        const errorEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ Erro ao iniciar o rastreamento")
          .setDescription("Não consegui encontrar esse ID no Roblox.\nVerifique se o **ID existe** e tente novamente.")
          .setTimestamp();

        return interaction.editReply({ embeds: [errorEmbed], content: "" });
      }
    }
  } catch (err) {
    log(`Erro no interactionCreate: ${err?.stack || err?.message || err}`, "ERROR");
  }
});

/* ================= LOOP (GANHOS) ================= */
setInterval(async () => {
  if (isCheckingLoop) return;
  isCheckingLoop = true;

  try {
    const now = new Date();

    if (tickCache.size > 5000) tickCache.clear();

    if (now.getDate() !== lastResetDay) {
      lastResetDay = now.getDate();
      for (const id in usersData) {
        const u = usersData[id];
        if (!u?.targets) continue;
        u.targets.profile.gainedToday = 0;
        u.targets.group.gainedToday = 0;
        u.targets.profile.lastUpdate = Date.now();
        u.targets.group.lastUpdate = Date.now();

        await upsertTargetToDB(id, "profile", u.targets.profile);
        await upsertTargetToDB(id, "group", u.targets.group);
      }
      saveData(usersData);
      log("Reset diário automático", "WARN");
    }

    for (const id in usersData) {
      const u = usersData[id];
      if (!u?.targets) continue;

      for (const type of ["profile", "group"]) {
        const t = u.targets[type];
        if (!t?.tracking) continue;
        if (!t.robloxId) continue;

        try {
          if (type === "group") {
            const { total, username } = await getCurrentTotalByType(type, t.robloxId);
            if (username) t.username = username;

            const base = Number(t.baseTotal ?? 0);
            let gained = total - base;
            if (!Number.isFinite(gained) || gained < 0) gained = 0;

            if (gained > 0) {
              t.baseTotal = total;
              t.gainedToday = Number(t.gainedToday ?? 0) + gained;
              t.lastUpdate = Date.now();

              saveData(usersData);
              saveDailyHistory(id, type, total);
              await upsertTargetToDB(id, type, t);

              const user = await client.users.fetch(id);
              const msg = await user.send({
                embeds: [
                  changeEmbed({
                    title: "📈 Novos membros no grupo!",
                    username: t.username,
                    gained,
                    today: t.gainedToday,
                    total
                  })
                ]
              });

              if (NOTIF_TTL_MS > 0) setTimeout(() => msg.delete().catch(() => {}), NOTIF_TTL_MS);

              log(`${type.toUpperCase()} +${gained} | ${t.username} => ${total}`, "SUCCESS");
            } else {
              t.lastUpdate = Date.now();
              saveData(usersData);
              await upsertTargetToDB(id, type, t);
            }
            continue;
          }

          const uname = await getRobloxUsername(t.robloxId).catch(() => t.username);
          if (uname) t.username = uname;

          const det = await detectProfileGainsByListPaged(t, 6);
          let gained = Number(det.gained || 0);
          if (!Number.isFinite(gained) || gained < 0) gained = 0;

          if (det.newLastId) t.lastFollowerId = Number(det.newLastId) || t.lastFollowerId || 0;

          if (gained > 0) {
            t.baseTotal = Number(t.baseTotal || 0) + gained;
            t.gainedToday = Number(t.gainedToday ?? 0) + gained;
            t.lastUpdate = Date.now();

            saveData(usersData);
            saveDailyHistory(id, "profile", t.baseTotal);
            await upsertTargetToDB(id, "profile", t);

            const user = await client.users.fetch(id);
            const msg = await user.send({
              embeds: [
                changeEmbed({
                  title: "📈 Novos seguidores detectados!",
                  username: t.username,
                  gained,
                  today: t.gainedToday,
                  total: Number(t.baseTotal || 0)
                })
              ]
            });

            if (NOTIF_TTL_MS > 0) setTimeout(() => msg.delete().catch(() => {}), NOTIF_TTL_MS);

            log(`PROFILE +${gained} | ${t.username} | pages=${det.pages} | lastId=${t.lastFollowerId}`, "SUCCESS");
          } else {
            t.lastUpdate = Date.now();
            saveData(usersData);
            await upsertTargetToDB(id, "profile", t);
          }
        } catch (errUser) {
          log(`Erro no loop (${type}) para ${id}: ${errUser?.message || errUser}`, "ERROR");
        }
      }
    }
  } catch (err) {
    log(`Erro geral no loop: ${err?.stack || err?.message || err}`, "ERROR");
  } finally {
    isCheckingLoop = false;
  }
}, 300_000 + Math.floor(Math.random() * 2500));

/* ================= SYNC LEVE (followers/count) ================= */

async function runLightSync() {
  try {
    if (isCheckingLoop) return;

    const now = Date.now();

    for (const id in usersData) {
      const u = usersData[id];
      if (!u?.targets?.profile) continue;

      const t = u.targets.profile;
      if (!t?.tracking) continue;
      if (!t.robloxId) continue;

      try {
        const realTotal = await getFollowersCount(t.robloxId);

        const saved = Number(t.baseTotal ?? 0);
        const real = Number(realTotal ?? 0);

        if (!Number.isFinite(real) || real <= 0) continue;

        if (real !== saved) {
          t.baseTotal = real;
          t.lastUpdate = now;

          saveData(usersData);
          saveDailyHistory(id, "profile", real);
          await upsertTargetToDB(id, "profile", t);

          log(`SYNC LEVE: PROFILE total ajustado ${t.username || ""} | ${saved} -> ${real}`, "INFO");
        }
      } catch (e) {
        log(`SYNC LEVE falhou p/ ${id}: ${e?.message || e}`, "WARN");
      }
    }

  } catch (err) {
    log(`Erro geral no SYNC LEVE: ${err?.stack || err?.message || err}`, "ERROR");
  }
}

/* ================= AGENDAR PARA 18:00 ================= */

function scheduleDailySync() {
  const now = new Date();
  const target = new Date();

  target.setHours(18, 0, 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const delay = target - now;

  log(`SYNC LEVE agendado para ${target.toLocaleString()}`, "INFO");

  setTimeout(() => {
    runLightSync();

    setInterval(runLightSync, 24 * 60 * 60 * 1000);
  }, delay);
}

scheduleDailySync();

/* ================= RESET VIA MENSAGEM (DM) ================= */
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (message.guild) return;

    if (message.content.trim() === "!reset") {
      if (message.author.id !== OWNER_ID) {
        return message.reply("❌ Você não tem permissão para isso.");
      }

      await message.reply("🔄 Reiniciando o bot...");
      setTimeout(() => process.exit(0), 1200);
    }
  } catch (err) {
    log(`Erro messageCreate: ${err?.stack || err?.message || err}`, "ERROR");
  }
});

/* ================= LOGIN ================= */
client.login(token);
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = new Set([
  'https://functiondotexe.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);
const ATTRIBUTES_MIRROR_URL = 'https://r.jina.ai/http://wiki.hypixel.net/Attributes';
const FORGE_MIRROR_RAW_URL = 'https://r.jina.ai/http://wiki.hypixel.net/index.php?title=The_Forge&action=raw';
const FORGE_MIRROR_PAGE_URL = 'https://r.jina.ai/http://wiki.hypixel.net/The_Forge';
const ATTRIBUTE_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const FORGE_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
let attributeCache = { fetchedAt: 0, shards: [] };
let forgeCache = { fetchedAt: 0, recipes: [] };
let forgeRetryAfterUntil = 0;
const IMAGE_PROXY_ALLOWLIST = [
  'wiki.hypixel.net',
  'hypixel-skyblock.fandom.com',
  'static.wikia.nocookie.net'
];

// serve static files from public
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

const HYPIXEL_KEY = process.env.HYPIXEL_KEY;
const HYPIXEL_API_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const HYPIXEL_ITEMS_API_URL = 'https://api.hypixel.net/resources/skyblock/items';

function cleanText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNameKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCell(value) {
  const text = cleanText(value).replace(/[\u2013\u2014]/g, '-').trim();
  if (!text || text === '-') return '';
  return text;
}

function nameToShardId(name) {
  const slug = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) return '';
  return `SHARD_${slug}`;
}

function parseNameCell(cell) {
  const cleaned = cleanText(cell).replace(/^Image\s+\d+\s+/i, '').trim();
  return cleaned;
}

function parseImageUrl(cell) {
  const match = String(cell || '').match(/!\[[^\]]*]\(([^)]+)\)/);
  return match ? match[1] : '';
}

function parseAttributeShards(markdown) {
  const rows = [];
  const lines = String(markdown || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('| ![Image')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 11) continue;

    const name = parseNameCell(cells[0]);
    const imageUrl = parseImageUrl(cells[0]);
    const rarity = normalizeCell(cells[1]).toUpperCase();
    const id = Number.parseInt(normalizeCell(cells[2]), 10);
    if (!name || !Number.isFinite(id)) continue;

    const category = normalizeCell(cells[3]).toUpperCase();
    const family = normalizeCell(cells[4]);
    const input1 = normalizeCell(cells[7]);
    const input2 = normalizeCell(cells[8]);
    const idResult = normalizeCell(cells[9]);
    const idOrigins = normalizeCell(cells[10])
      .split(',')
      .map((n) => normalizeCell(n))
      .filter(Boolean);

    rows.push({
      name,
      shardId: nameToShardId(name),
      rarity,
      id,
      imageUrl,
      category,
      family,
      input1,
      input2,
      idResult,
      idOrigins
    });
  }
  return rows;
}

async function getAttributeShardData() {
  const fresh = Date.now() - attributeCache.fetchedAt < ATTRIBUTE_CACHE_TTL_MS && attributeCache.shards.length > 0;
  if (fresh) return attributeCache.shards;

  const response = await axios.get(ATTRIBUTES_MIRROR_URL, { timeout: 15000 });
  const shards = parseAttributeShards(response.data);
  attributeCache = { fetchedAt: Date.now(), shards };
  return shards;
}

function toHours(durationText) {
  const text = cleanText(durationText).toLowerCase();
  if (!text) return null;
  let hours = 0;
  const dayMatch = text.match(/(\d+)\s*day/);
  const hourMatch = text.match(/(\d+)\s*hour/);
  const minuteMatch = text.match(/(\d+)\s*minute/);
  const secondMatch = text.match(/(\d+)\s*second/);
  if (dayMatch) hours += Number(dayMatch[1]) * 24;
  if (hourMatch) hours += Number(hourMatch[1]);
  if (minuteMatch) hours += Number(minuteMatch[1]) / 60;
  if (secondMatch) hours += Number(secondMatch[1]) / 3600;
  return hours > 0 ? hours : null;
}

function parseForgeRecipesFromRaw(raw, idByName) {
  const lines = String(raw || '').split(/\r?\n/);
  const recipes = [];
  let section = '';

  const start = lines.findIndex((l) => l.trim() === '==Recipes==');
  if (start < 0) return recipes;

  let i = start;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('===') && line.endsWith('===')) {
      section = line.replace(/=/g, '').trim();
      i += 1;
      continue;
    }
    if (!line.startsWith('{{Forge Table Entry|')) {
      i += 1;
      continue;
    }

    const entryMatch = line.match(/\{\{Forge Table Entry\|([^}]*)}}/);
    if (!entryMatch) {
      i += 1;
      continue;
    }
    const body = entryMatch[1];
    const itemMatch = body.match(/(?:^|\|)\s*item\s*=\s*([A-Z0-9_]+)/i);
    if (!itemMatch) {
      i += 1;
      continue;
    }
    const outputId = itemMatch[1].trim().toUpperCase();
    const outputName = cleanText(outputId.replaceAll('_', ' '));

    // Pull the item page raw and parse its forge recipe block.
    recipes.push({
      output: outputId,
      name: outputName,
      inputs: [],
      hours: null,
      hotm: null,
      category: section || 'Forge'
    });
    i += 1;
  }

  return recipes;
}

function parseForgeFromTemplateRaw(raw, outputId) {
  const text = String(raw || '');
  if (!text.includes('Forge_Item')) return null;
  const aggregated = new Map();
  const durationMatch = text.match(/\|\s*duration\s*=\s*([^|}]+)/i);
  const hours = durationMatch ? toHours(durationMatch[1]) : null;

  const inputRegex = /in\d+\s*=\s*\{\{Item\/([A-Z0-9_]+)\|[^}]*}}\s*,\s*(\d+)/gi;
  let m;
  while ((m = inputRegex.exec(text)) !== null) {
    const id = m[1].toUpperCase();
    const qty = Number(m[2]);
    if (!id || !Number.isFinite(qty) || qty <= 0) continue;
    aggregated.set(id, (aggregated.get(id) || 0) + qty);
  }
  const inputs = [...aggregated.entries()].map(([productId, qty]) => ({
    productId,
    qty,
    label: productId.replaceAll('_', ' ')
  }));

  if (!inputs.length) return null;
  return {
    output: outputId,
    inputs,
    hours,
    hotm: null
  };
}

function parseForgeHotmMapFromRenderedPage(renderedMarkdown, outputIds, nameById) {
  const lines = String(renderedMarkdown || '').split(/\r?\n/).map((l) => cleanText(l));
  const hotmMap = new Map();
  const nameToId = new Map();
  outputIds.forEach((id) => {
    const name = normalizeNameKey(nameById.get(id) || id.replaceAll('_', ' '));
    if (name) nameToId.set(name, id);
  });

  const recipesStart = lines.findIndex((l) => l === 'RECIPES');
  const recipesEnd = lines.findIndex((l, idx) => idx > recipesStart && (l === 'TRIVIA' || l === 'HISTORY'));
  const start = recipesStart >= 0 ? recipesStart : 0;
  const end = recipesEnd > start ? recipesEnd : lines.length;

  for (let i = start; i < end; i++) {
    const key = normalizeNameKey(lines[i]);
    const outputId = nameToId.get(key);
    if (!outputId) continue;
    for (let j = i; j < Math.min(i + 18, end); j++) {
      const m = lines[j].match(/Heart of the Mountain Tier\s*(\d+)/i);
      if (m) {
        hotmMap.set(outputId, Number(m[1]));
        break;
      }
    }
  }

  return hotmMap;
}

async function getItemsList() {
  const response = await axios.get(HYPIXEL_ITEMS_API_URL, { timeout: 20000 });
  const data = response.data;
  if (!data.success || !Array.isArray(data.items)) return [];
  return data.items;
}

async function getLocalForgeRecipesFallback() {
  try {
    const file = path.join(__dirname, 'public', 'forge-recipes.json');
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function logForgeError(err) {
  const status = err?.response?.status;
  const msg = err?.response?.data?.readableMessage || err?.message || 'unknown error';
  if (status === 429) return;
  console.warn(`Forge recipe sync warning: ${status || 'n/a'} ${msg}`);
}

function getRetryAfterMs(err) {
  const raw = err?.response?.headers?.['retry-after'];
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  return 60 * 1000;
}

async function getForgeRecipes() {
  const fresh = Date.now() - forgeCache.fetchedAt < FORGE_CACHE_TTL_MS && forgeCache.recipes.length > 0;
  if (fresh) return forgeCache.recipes;
  if (Date.now() < forgeRetryAfterUntil) {
    if (forgeCache.recipes.length > 0) return forgeCache.recipes;
    const local = await getLocalForgeRecipesFallback();
    if (local.length > 0) {
      forgeCache = { fetchedAt: Date.now(), recipes: local };
      return local;
    }
    return [];
  }

  try {
    const [forgeRawResp, forgePageResp, items, bazaarResp] = await Promise.all([
      axios.get(FORGE_MIRROR_RAW_URL, { timeout: 20000 }),
      axios.get(FORGE_MIRROR_PAGE_URL, { timeout: 20000 }),
      getItemsList(),
      axios.get(HYPIXEL_API_URL, { params: HYPIXEL_KEY ? { key: HYPIXEL_KEY } : {}, timeout: 20000 })
    ]);
    const bazaarProducts = bazaarResp?.data?.products || {};
    const bazaarIds = new Set(Object.keys(bazaarProducts));
    const idByName = new Map();
    const nameById = new Map();
    items.forEach((item) => {
      const key = normalizeNameKey(item.name || item.id);
      if (key && !idByName.has(key)) idByName.set(key, item.id);
      nameById.set(item.id, cleanText(item.name || item.id));
    });

    const stubRecipes = parseForgeRecipesFromRaw(forgeRawResp.data, idByName);
    const uniqueOutputIds = [...new Set(stubRecipes.map((r) => r.output))].filter((id) => bazaarIds.has(id));
    const hotmByOutput = parseForgeHotmMapFromRenderedPage(forgePageResp.data, uniqueOutputIds, nameById);
    const built = [];
    const chunkSize = 4;
    for (let i = 0; i < uniqueOutputIds.length; i += chunkSize) {
      const chunk = uniqueOutputIds.slice(i, i + chunkSize);
      const batch = await Promise.allSettled(
        chunk.map(async (outputId) => {
          const url = `https://r.jina.ai/http://wiki.hypixel.net/index.php?title=Template:Recipe/${encodeURIComponent(outputId)}&action=raw`;
          const recipeRaw = await axios.get(url, { timeout: 15000 });
          const parsed = parseForgeFromTemplateRaw(recipeRaw.data, outputId);
          if (!parsed) return null;
          if (!parsed.inputs.every((input) => bazaarIds.has(input.productId))) return null;
          const stub = stubRecipes.find((r) => r.output === outputId);
          return {
            name: nameById.get(outputId) || cleanText((stub?.name || outputId).replaceAll('_', ' ')),
            output: outputId,
            inputs: parsed.inputs,
            hours: parsed.hours || null,
            hotm: hotmByOutput.get(outputId) ?? parsed.hotm ?? null,
            category: stub?.category || 'Forge'
          };
        })
      );
      batch.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) built.push(result.value);
      });
    }

    if (built.length > 0) {
      forgeCache = { fetchedAt: Date.now(), recipes: built };
      return built;
    }
  } catch (err) {
    logForgeError(err);
    if (err?.response?.status === 429) {
      forgeRetryAfterUntil = Date.now() + getRetryAfterMs(err);
    }
  }

  if (forgeCache.recipes.length > 0) {
    return forgeCache.recipes;
  }

  const local = await getLocalForgeRecipesFallback();
  if (local.length > 0) {
    forgeCache = { fetchedAt: Date.now(), recipes: local };
  }
  return local;
}

app.get('/api/prices', async (req, res) => {
  try {
    const params = HYPIXEL_KEY ? { key: HYPIXEL_KEY } : {};
    const response = await axios.get(HYPIXEL_API_URL, { params });
    const data = response.data;
    if (!data.success) {
      return res.status(500).json({ error: data.cause || 'Hypixel API error' });
    }
    res.json(data.products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Request failed' });
  }
});

app.get('/api/items', async (req, res) => {
  try {
    const response = await axios.get(HYPIXEL_ITEMS_API_URL);
    const data = response.data;
    if (!data.success) {
      return res.status(500).json({ error: data.cause || 'Hypixel items API error' });
    }

    const ids = String(req.query.ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (!ids.length) {
      return res.json(data.items);
    }

    const wanted = new Set(ids);
    const filtered = data.items.filter((item) => wanted.has(item.id));
    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Request failed' });
  }
});

app.get('/api/attributes', async (req, res) => {
  try {
    const shards = await getAttributeShardData();
    res.json({ source: 'wiki.hypixel.net/Attributes', count: shards.length, shards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load attribute shard metadata' });
  }
});

app.get('/api/forge-recipes', async (req, res) => {
  try {
    const recipes = await getForgeRecipes();
    res.json({
      source: 'wiki.hypixel.net/The_Forge',
      count: recipes.length,
      recipes
    });
  } catch (err) {
    logForgeError(err);
    res.status(500).json({ error: 'Unable to load forge recipe metadata' });
  }
});

app.get('/api/icon-proxy', async (req, res) => {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw) {
      return res.status(400).json({ error: 'Missing url' });
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return res.status(400).json({ error: 'Invalid url' });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Unsupported protocol' });
    }
    if (!IMAGE_PROXY_ALLOWLIST.includes(parsed.hostname)) {
      return res.status(403).json({ error: 'Host not allowed' });
    }

    const response = await axios.get(parsed.toString(), {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://wiki.hypixel.net/Attributes',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      return res.status(502).json({ error: 'Upstream did not return an image' });
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(response.data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Unable to fetch icon' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});


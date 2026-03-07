const FLAWED_TO_PERFECT = 32000;
const FINE_TO_PERFECT = 400;
const STATIC_SHARD_FUSION_RECIPES = [
  // Edit quantities/IDs here to match your preferred shard fusion routes.
  {
    name: 'Enchanted Glacite (from Glacite Shards)',
    output: 'ENCHANTED_GLACITE',
    inputs: [
      { productId: 'GLACITE_SHARD', qty: 160, label: 'Glacite Shard' }
    ]
  },
  {
    name: 'Enchanted Prismarine Crystals',
    output: 'ENCHANTED_PRISMARINE_CRYSTALS',
    inputs: [
      { productId: 'PRISMARINE_CRYSTALS', qty: 160, label: 'Prismarine Crystals' }
    ]
  }
];
const ATTRIBUTE_SHARD_PREFIX = 'SHARD_';
const RARITY_RANK = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5
};
const REPTILE_FAMILY_KEYWORDS = ['REPTILE', 'FROG', 'EEL', 'CROCODILE', 'SERPENT', 'TURTLE', 'LIZARD', 'SNAKE', 'AMPHIBIAN'];
const SHARD_CATEGORIES = new Set(['FOREST', 'WATER', 'COMBAT']);
const BAZAAR_SELL_TAX = 0.0125;
const HOURS_PER_WEEK = 24 * 7;
const MAX_TOTAL_WAIT_HOURS = 168;
const MIN_LIQUIDITY_MULTIPLE = 0.5;
const BLOCK_MATERIALS = new Set([
  'obsidian',
  'cactus',
  'hay_block',
  'packed_ice',
  'ice',
  'log',
  'log_2',
  'leaves',
  'leaves_2',
  'melon_block',
  'prismarine',
  'prismarine_shard',
  'prismarine_crystals'
]);
const MATERIAL_ALIASES = {
  water_lily: 'waterlily',
  eye_of_ender: 'ender_eye',
  lily_pad: 'waterlily'
};
const IS_GITHUB_PAGES = window.location.hostname.endsWith('.github.io');

const state = {
  activeTab: 'forge',
  forgeRows: [],
  forgeConfigs: [],
  allCraftRows: [],
  craftRows: [],
  shardRows: [],
  iconMap: {},
  craftLimit: 25,
  hideGemCrafts: false,
  allowMiddleCraft: false,
  inputPriceMode: 'instabuy',
  attributeShards: [],
  lastPayload: null,
  darkMode: true
};

function formatNum(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });

}

function formatPer(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function buyOrderPrice(product) {
  if (state.inputPriceMode === 'buyorder') {
    const topBid = product?.sell_summary?.[0]?.pricePerUnit;
    if (topBid != null) return topBid;
  } else {
    const instantBuy = product?.buy_summary?.[0]?.pricePerUnit;
    if (instantBuy != null) return instantBuy;
  }
  const quick = product?.quick_status;
  if (!quick) return null;
  return state.inputPriceMode === 'buyorder' ? quick.sellPrice : quick.buyPrice;
}

function sellOfferPrice(product) {
  const topSellOffer = product?.sell_summary?.[0]?.pricePerUnit;
  if (topSellOffer != null) return topSellOffer;
  const quick = product?.quick_status;
  if (!quick) return null;
  return quick.sellPrice;
}

function buyMovingWeek(product) {
  const quick = product?.quick_status;
  if (!quick) return null;
  return quick.buyMovingWeek ?? null;
}

function sellMovingWeek(product) {
  const quick = product?.quick_status;
  if (!quick) return null;
  return quick.sellMovingWeek ?? null;
}

function estimateBuyOrderFillHours(product, qty) {
  const week = sellMovingWeek(product);
  if (!week || week <= 0) return Number.POSITIVE_INFINITY;
  const perHour = week / HOURS_PER_WEEK;
  return qty / perHour;
}

function estimateSellOfferFillHours(product, qty) {
  const week = buyMovingWeek(product);
  if (!week || week <= 0) return Number.POSITIVE_INFINITY;
  const perHour = week / HOURS_PER_WEEK;
  return qty / perHour;
}

function evaluateShardPlan(payload, outputId, outputQty, inputs) {
  const outputProduct = payload[outputId];
  const outputUnit = sellOfferPrice(outputProduct);
  if (!outputUnit) return null;

  let inputCost = 0;
  let inputWait = 0;
  let inputLiquidity = Number.POSITIVE_INFINITY;
  for (const input of inputs) {
    const product = payload[input.productId];
    const unit = buyOrderPrice(product);
    if (!unit) return null;
    inputCost += unit * input.qty;

    const fillH = estimateBuyOrderFillHours(product, input.qty);
    inputWait = Math.max(inputWait, fillH);

    const week = sellMovingWeek(product);
    if (!week || week <= 0) return null;
    inputLiquidity = Math.min(inputLiquidity, week / input.qty);
  }

  const outputGross = outputUnit * outputQty;
  const outputNet = outputGross * (1 - BAZAAR_SELL_TAX);
  const outputWait = estimateSellOfferFillHours(outputProduct, outputQty);
  const outputWeek = buyMovingWeek(outputProduct);
  if (!outputWeek || outputWeek <= 0) return null;
  const outputLiquidity = outputWeek / outputQty;
  const totalWaitHours = inputWait + outputWait;
  const liquidityScore = Math.min(inputLiquidity, outputLiquidity);
  const profit = outputNet - inputCost;

  return {
    netCost: inputCost,
    outputSell: outputNet,
    profit,
    margin: inputCost > 0 ? (profit / inputCost) * 100 : 0,
    totalWaitHours,
    liquidityScore
  };
}

function svgFallbackIcon(label) {
  const h = Array.from(String(label || 'x')).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const c1 = `hsl(${h % 360},70%,55%)`;
  const c2 = `hsl(${(h + 80) % 360},55%,38%)`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' rx='6' fill='#111'/><rect x='4' y='4' width='32' height='32' rx='4' fill='${c2}'/><rect x='6' y='6' width='12' height='12' fill='${c1}'/><rect x='20' y='6' width='12' height='12' fill='${c2}'/><rect x='6' y='20' width='12' height='12' fill='${c2}'/><rect x='20' y='20' width='12' height='12' fill='${c1}'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function materialIconUrl(item) {
  let material = (item?.material || '').toLowerCase();
  if (!material) return null;
  material = MATERIAL_ALIASES[material] || material;
  if (material.includes('block') || BLOCK_MATERIALS.has(material)) {
    return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.8.8/assets/minecraft/textures/blocks/${material}.png`;
  }
  return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.8.8/assets/minecraft/textures/items/${material}.png`;
}

function decodeSkinUrl(item) {
  if (!item?.skin?.value) return null;
  try {
    const json = JSON.parse(atob(item.skin.value));
    const textureUrl = json?.textures?.SKIN?.url || null;
    if (!textureUrl) return null;
    const hash = textureUrl.split('/').pop();
    if (!hash) return null;
    return `https://mc-heads.net/head/${hash}/32`;
  } catch {
    return null;
  }
}

function buildIconMap(items) {
  const map = {};
  items.forEach((item) => {
    map[item.id] = decodeSkinUrl(item) || materialIconUrl(item) || svgFallbackIcon(item.name || item.id);
  });
  return map;
}

function buildAttributeIconMap(attributeShards) {
  const map = {};
  (attributeShards || []).forEach((meta) => {
    if (meta?.shardId && meta?.imageUrl) {
      map[meta.shardId] = IS_GITHUB_PAGES
        ? meta.imageUrl
        : `/api/icon-proxy?url=${encodeURIComponent(meta.imageUrl)}`;
    }
  });
  return map;
}

function getItemCell(name, id) {
  const icon = state.iconMap[id] || svgFallbackIcon(name);
  const fallback = svgFallbackIcon(name);
  return `
    <div class="item-cell">
      <div class="item-frame">
        <img class="item-icon" src="${icon}" data-fallback="${fallback}" alt="${name}" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.fallback;" />
      </div>
      <span>${name}</span>
    </div>
  `;

}
function gemstoneRow(payload, type, extra) {
  const flawed = payload[`FLAWED_${type}_GEM`];
  const fine = payload[`FINE_${type}_GEM`];
  const perfectId = `PERFECT_${type}_GEM`;
  const perfect = payload[perfectId];
  if (!flawed || !fine || !perfect) return null;

  const flawedBO = buyOrderPrice(flawed);
  const fineBO = buyOrderPrice(fine);
  const perfectSO = sellOfferPrice(perfect);
  if (!flawedBO || !fineBO || !perfectSO) return null;

  const flawedCost = flawedBO * FLAWED_TO_PERFECT;
  const fineCost = fineBO * FINE_TO_PERFECT;
  const useFlawed = flawedCost <= fineCost;
  const baseCost = Math.min(flawedCost, fineCost);
  const inputLabel = useFlawed
    ? `Flawed x${FLAWED_TO_PERFECT} (${formatPer(flawedBO)} ea)`
    : `Fine x${FINE_TO_PERFECT} (${formatPer(fineBO)} ea)`;

  let extraCost = 0;
  let extraLabel = '-';
  if (extra?.productId) {
    const extraBO = buyOrderPrice(payload[extra.productId]);
    if (extraBO) {
      extraCost = extraBO * (extra.qty || 1);
      extraLabel = `${extra.label} x${extra.qty || 1}: ${formatNum(extraCost)}`;
    }
  }

  const netCost = baseCost + extraCost;
  const profit = perfectSO - netCost;

  return {
    name: type,
    outputId: perfectId,
    category: 'Gemstone',
    inputsLabel: inputLabel,
    extraLabel,
    netCost,
    outputSell: perfectSO,
    profit,
    profitPerHour: profit / 20,
    forgeHours: 20,
    hotm: 6
  };
}

function recipeRow(payload, config) {
  const output = payload[config.output];
  if (!output) return null;

  let netCost = 0;
  const parts = [];
  for (const input of config.inputs) {
    const inputProduct = payload[input.productId];
    const bo = buyOrderPrice(inputProduct);
    if (!bo) return null;
    netCost += bo * input.qty;
    parts.push(`${input.qty}x ${input.label}`);
  }

  const outputSell = sellOfferPrice(output);
  if (!outputSell) return null;
  const profit = outputSell - netCost;

  return {
    name: config.name,
    outputId: config.output,
    category: config.category || 'Forge Item',
    inputsLabel: parts.join(', '),
    extraLabel: '-',
    netCost,
    outputSell,
    profit,
    profitPerHour: config.hours ? profit / config.hours : null,
    forgeHours: config.hours || null,
    hotm: config.hotm || null,
    margin: netCost > 0 ? (profit / netCost) * 100 : 0
  };
}

function sanitizeForgeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.output || !Array.isArray(raw.inputs) || !raw.inputs.length) return null;
  const inputs = raw.inputs
    .filter((input) => input && input.productId && Number.isFinite(Number(input.qty)) && Number(input.qty) > 0)
    .map((input) => ({
      productId: String(input.productId),
      qty: Number(input.qty),
      label: String(input.label || input.productId).replaceAll('_', ' ')
    }));
  if (!inputs.length) return null;
  return {
    name: String(raw.name || raw.output).replaceAll('_', ' '),
    output: String(raw.output),
    inputs,
    hours: Number.isFinite(Number(raw.hours)) ? Number(raw.hours) : null,
    hotm: Number.isFinite(Number(raw.hotm)) ? Number(raw.hotm) : null
  };
}

async function fetchForgeConfigs() {
  try {
    const resp = await fetch('/api/forge-recipes');
    const contentType = resp.headers.get('content-type') || '';
    if (resp.ok && contentType.includes('application/json')) {
      const payload = await resp.json();
      const recipes = Array.isArray(payload?.recipes) ? payload.recipes : [];
      const parsed = recipes.map(sanitizeForgeConfig).filter(Boolean);
      if (parsed.length) return parsed;
    }
  } catch {
    // fallback below
  }

  try {
    const localResp = await fetch('/forge-recipes.json');
    const localType = localResp.headers.get('content-type') || '';
    if (!localResp.ok || !localType.includes('application/json')) return [];
    const localPayload = await localResp.json();
    if (!Array.isArray(localPayload)) return [];
    return localPayload.map(sanitizeForgeConfig).filter(Boolean);
  } catch {
    return [];
  }
}

function buildForgeRows(payload, configs) {
  const rows = [];
  const gemstoneRows = [
    gemstoneRow(payload, 'TOPAZ'),
    gemstoneRow(payload, 'SAPPHIRE', { productId: 'PRECURSOR_APPARATUS', qty: 1, label: 'Precursor Apparatus' }),
    gemstoneRow(payload, 'AMETHYST', { productId: 'JUNGLE_KEY', qty: 1, label: 'Jungle Key' })
  ].filter(Boolean);
  rows.push(...gemstoneRows);

  (configs || []).forEach((cfg) => {
    const row = recipeRow(payload, cfg);
    if (row) rows.push(row);
  });

  rows.sort((a, b) => (b.profitPerHour || 0) - (a.profitPerHour || 0));
  return rows;
}

function buildCraftRows(payload) {
  const manualRecipeOptions = {
    ENCHANTED_DIAMOND: [[{ productId: 'DIAMOND', qty: 160 }]],
    ENCHANTED_DIAMOND_BLOCK: [[{ productId: 'ENCHANTED_DIAMOND', qty: 160 }]],
    ENCHANTED_EMERALD: [[{ productId: 'EMERALD', qty: 160 }]],
    ENCHANTED_EMERALD_BLOCK: [[{ productId: 'ENCHANTED_EMERALD', qty: 160 }]],
    ENCHANTED_GOLD: [[{ productId: 'GOLD_INGOT', qty: 160 }]],
    ENCHANTED_GOLD_BLOCK: [[{ productId: 'ENCHANTED_GOLD', qty: 160 }]],
    ENCHANTED_IRON: [[{ productId: 'IRON_INGOT', qty: 160 }]],
    ENCHANTED_IRON_BLOCK: [[{ productId: 'ENCHANTED_IRON', qty: 160 }]],
    ENCHANTED_REDSTONE: [[{ productId: 'REDSTONE', qty: 160 }]],
    ENCHANTED_REDSTONE_BLOCK: [[{ productId: 'ENCHANTED_REDSTONE', qty: 160 }]],
    ENCHANTED_COAL: [[{ productId: 'COAL', qty: 160 }]],
    ENCHANTED_COAL_BLOCK: [[{ productId: 'ENCHANTED_COAL', qty: 160 }]],
    ENCHANTED_LAPIS_LAZULI: [[{ productId: 'INK_SACK:4', qty: 160 }]],
    ENCHANTED_LAPIS_LAZULI_BLOCK: [[{ productId: 'ENCHANTED_LAPIS_LAZULI', qty: 160 }]],
    ENCHANTED_QUARTZ: [[{ productId: 'QUARTZ', qty: 160 }]],
    ENCHANTED_QUARTZ_BLOCK: [[{ productId: 'ENCHANTED_QUARTZ', qty: 160 }]],
    ENCHANTED_ENDER_PEARL: [[{ productId: 'ENDER_PEARL', qty: 20 }]],
    ENCHANTED_EYE_OF_ENDER: [[
      { productId: 'ENCHANTED_ENDER_PEARL', qty: 16 },
      { productId: 'BLAZE_ROD', qty: 32 }
    ]],
    ENCHANTED_SUGAR: [[{ productId: 'SUGAR_CANE', qty: 160 }]],
    ENCHANTED_SUGAR_CANE: [[{ productId: 'ENCHANTED_SUGAR', qty: 160 }]],
    ENCHANTED_CACTUS_GREEN: [[{ productId: 'CACTUS', qty: 160 }]],
    ENCHANTED_CACTUS: [[{ productId: 'ENCHANTED_CACTUS_GREEN', qty: 160 }]],
    ENCHANTED_BLAZE_POWDER: [[{ productId: 'BLAZE_ROD', qty: 80 }]],
    ENCHANTED_BLAZE_ROD: [[{ productId: 'ENCHANTED_BLAZE_POWDER', qty: 160 }]],
    ENCHANTED_HUGE_MUSHROOM_1: [[{ productId: 'ENCHANTED_BROWN_MUSHROOM', qty: 160 }]],
    ENCHANTED_HUGE_MUSHROOM_2: [[{ productId: 'ENCHANTED_RED_MUSHROOM', qty: 160 }]],
    TARANTULA_SILK: [[
      { productId: 'TARANTULA_WEB', qty: 128 },
      { productId: 'ENCHANTED_FLINT', qty: 32 }
    ]],
    // Wiki: Enchanted Packed Ice is crafted from 160 Enchanted Ice.
    ENCHANTED_PACKED_ICE: [
      [{ productId: 'ENCHANTED_ICE', qty: 160 }],
      [{ productId: 'PACKED_ICE', qty: 160 }]
    ]
  };

  const excludedAuto = new Set([
    // Avoid questionable special chains where direct 160x transform is often wrong.
    'ENCHANTED_GOLDEN_CARROT',
    'ENCHANTED_BAKED_POTATO',
    'ENCHANTED_COOKIE',
    'ENCHANTED_BREAD'
  ]);

  const getAutoRecipeOptions = (outputId) => {
    if (excludedAuto.has(outputId)) return null;

    if (outputId.startsWith('FINE_') && outputId.endsWith('_GEM')) {
      const gem = outputId.slice('FINE_'.length, -'_GEM'.length);
      const flawed = `FLAWED_${gem}_GEM`;
      if (payload[flawed]) return [[{ productId: flawed, qty: 80 }]];
    }

    if (outputId.startsWith('FLAWLESS_') && outputId.endsWith('_GEM')) {
      const gem = outputId.slice('FLAWLESS_'.length, -'_GEM'.length);
      const fine = `FINE_${gem}_GEM`;
      if (payload[fine]) return [[{ productId: fine, qty: 80 }]];
    }

    if (outputId.endsWith('_BLOCK')) {
      const base = outputId.slice(0, -'_BLOCK'.length);
      if (payload[base]) return [[{ productId: base, qty: 160 }]];
      return null;
    }

    if (outputId.startsWith('ENCHANTED_')) {
      const base = outputId.replace(/^ENCHANTED_/, '');
      // Avoid incorrect auto assumptions on special numeric IDs unless manually mapped.
      if (/_\d+$/.test(base)) return null;
      if (payload[base]) return [[{ productId: base, qty: 160 }]];
    }

    return null;
  };

  const getRecipeOptions = (outputId) => manualRecipeOptions[outputId] || getAutoRecipeOptions(outputId);

  const costMemo = new Map();
  const computeUnitCost = (id, stack = new Set()) => {
    if (costMemo.has(id)) return costMemo.get(id);
    if (stack.has(id)) return { cost: Number.POSITIVE_INFINITY, source: 'cycle' };
    stack.add(id);

    const buyCost = payload[id] ? buyOrderPrice(payload[id]) : null;

    if (!state.allowMiddleCraft) {
      const direct = buyCost != null ? { cost: buyCost, source: 'buy', parts: [] } : { cost: Number.POSITIVE_INFINITY, source: 'none', parts: [] };
      stack.delete(id);
      costMemo.set(id, direct);
      return direct;
    }

    const recipeOptions = getRecipeOptions(id);

    let craftCost = Number.POSITIVE_INFINITY;
    let craftParts = [];
    if (recipeOptions) {
      for (const recipeInputs of recipeOptions) {
        let sum = 0;
        const parts = [];
        let valid = true;
        for (const input of recipeInputs) {
          const inputCost = computeUnitCost(input.productId, stack);
          if (!Number.isFinite(inputCost.cost)) {
            valid = false;
            break;
          }
          const sub = inputCost.cost * input.qty;
          sum += sub;
          parts.push({
            id: input.productId,
            qty: input.qty,
            source: inputCost.source,
            unit: inputCost.cost
          });
        }
        if (valid && sum < craftCost) {
          craftCost = sum;
          craftParts = parts;
        }
      }
    }

    let result;
    if (buyCost != null && buyCost <= craftCost) {
      result = { cost: buyCost, source: 'buy', parts: [] };
    } else if (Number.isFinite(craftCost)) {
      result = { cost: craftCost, source: 'craft', parts: craftParts };
    } else if (buyCost != null) {
      result = { cost: buyCost, source: 'buy', parts: [] };
    } else {
      result = { cost: Number.POSITIVE_INFINITY, source: 'none', parts: [] };
    }

    stack.delete(id);
    costMemo.set(id, result);
    return result;
  };

  const inputLabelFromPlan = (inputs) => {
    return inputs
      .map((part) => {
        const mode = part.source === 'craft' ? 'crafted' : 'BO';
        if (part.source === 'craft' && Number.isFinite(part.directBuy)) {
          return `${part.qty}x ${part.id.replaceAll('_', ' ')} (crafted ${formatPer(part.unit)} ea, BO ${formatPer(part.directBuy)} ea)`;
        }
        return `${part.qty}x ${part.id.replaceAll('_', ' ')} (${mode} ${formatPer(part.unit)} ea)`;
      })
      .join(', ');
  };

  const rows = Object.keys(payload)
    .filter((outputId) => getRecipeOptions(outputId))
    .map((outputId) => ({
      name: outputId.replaceAll('_', ' '),
      output: outputId,
      recipeOptions: getRecipeOptions(outputId)
    }))
    .map((cfg) => {
      const outputSell = sellOfferPrice(payload[cfg.output]);
      if (!outputSell) return null;
      let best = null;
      for (const option of cfg.recipeOptions || []) {
        let inputCost = 0;
        const topParts = [];
        let valid = true;
        for (const input of option || []) {
          const unit = computeUnitCost(input.productId);
          if (!Number.isFinite(unit.cost)) {
            valid = false;
            break;
          }
          inputCost += unit.cost * input.qty;
          const directBuy = payload[input.productId] ? buyOrderPrice(payload[input.productId]) : null;
          topParts.push({ id: input.productId, qty: input.qty, source: unit.source, unit: unit.cost, directBuy });
        }
        if (!valid) continue;
        const profit = outputSell - inputCost;
        const candidate = {
          inputCost,
          topParts,
          profit,
          margin: inputCost > 0 ? (profit / inputCost) * 100 : 0
        };
        if (!best || candidate.profit > best.profit) best = candidate;
      }
      if (!best) return null;

      return {
        name: cfg.name,
        outputId: cfg.output,
        category: 'Craft',
        craftType: cfg.output.endsWith('_GEM') ? 'gemstone' : 'other',
        inputsLabel: inputLabelFromPlan(best.topParts),
        extraLabel: '-',
        netCost: best.inputCost,
        outputSell,
        profit: best.profit,
        margin: best.margin,
        profitPerHour: null,
        forgeHours: null,
        hotm: null
      };
    })
    .filter(Boolean)
    .filter((row) => row.profit > 0)
    .filter((row) => row.netCost >= 1000);

  rows.sort((a, b) => b.profit - a.profit);
  return rows;
}

function buildShardRows(payload) {
  const rows = [];
  STATIC_SHARD_FUSION_RECIPES.forEach((recipe) => {
    const planInputs = [];
    const labels = [];
    for (const input of recipe.inputs) {
      const product = payload[input.productId];
      const price = buyOrderPrice(product);
      if (!price) return;
      planInputs.push({ productId: input.productId, qty: input.qty });
      labels.push(`${input.qty}x ${input.label || input.productId.replaceAll('_', ' ')} (${formatPer(price)} ea)`);
    }
    const plan = evaluateShardPlan(payload, recipe.output, 1, planInputs);
    if (!plan) return;
    rows.push({
      name: recipe.name || recipe.output.replaceAll('_', ' '),
      outputId: recipe.output,
      category: recipe.category || 'Shard Fusion',
      inputsLabel: labels.join(', '),
      netCost: plan.netCost,
      outputSell: plan.outputSell,
      profit: plan.profit,
      margin: plan.margin,
      totalWaitHours: plan.totalWaitHours,
      liquidityScore: plan.liquidityScore
    });
  });

  const attributes = Array.isArray(state.attributeShards) ? state.attributeShards : [];
  const metaById = new Map(attributes.map((m) => [m.shardId, m]));
  const liveAttributeIds = Object.keys(payload).filter((id) => id.startsWith(ATTRIBUTE_SHARD_PREFIX));
  const liveMetas = liveAttributeIds
    .map((id) => metaById.get(id))
    .filter(Boolean);

  const pricedAnyShard = liveMetas
    .map((meta) => {
      const price = buyOrderPrice(payload[meta.shardId]);
      if (!price) return null;
      return { meta, unit: price, qty: fusionInputQty(meta), cost: price * fusionInputQty(meta) };
    })
    .filter(Boolean)
    .sort((a, b) => a.cost - b.cost);
  const cheapestAny = pricedAnyShard[0] || null;
  const chameleon = liveMetas.find((meta) => meta.name.toUpperCase() === 'CHAMELEON');
  const chameleonBO = chameleon ? buyOrderPrice(payload[chameleon.shardId]) : null;

  liveMetas.forEach((outputMeta) => {
    const outputProduct = payload[outputMeta.shardId];
    if (!sellOfferPrice(outputProduct)) return;

    const candidates = [];

    // Special Fusion: two constrained inputs, output quantity is 2.
    if (outputMeta.input1 && outputMeta.input2) {
      const in1 = cheapestMatchingInput(outputMeta.input1, liveMetas, payload);
      const in2 = cheapestMatchingInput(outputMeta.input2, liveMetas, payload);
      if (in1 && in2) {
        const outQty = 2;
        const evalPlan = evaluateShardPlan(payload, outputMeta.shardId, outQty, [
          { productId: in1.meta.shardId, qty: in1.qty },
          { productId: in2.meta.shardId, qty: in2.qty }
        ]);
        if (evalPlan) {
          candidates.push({
            method: 'Special',
            inputsLabel: `Slot 1: ${in1.qty}x ${in1.meta.name} (${formatPer(in1.unit)} ea), Slot 2: ${in2.qty}x ${in2.meta.name} (${formatPer(in2.unit)} ea)`,
            netCost: evalPlan.netCost,
            outputSell: evalPlan.outputSell,
            profit: evalPlan.profit,
            margin: evalPlan.margin,
            totalWaitHours: evalPlan.totalWaitHours,
            liquidityScore: evalPlan.liquidityScore
          });
        }
      }
    }

    // ID Fusion: first input determines output, second input can be any shard.
    if (Array.isArray(outputMeta.idOrigins) && outputMeta.idOrigins.length > 0 && cheapestAny) {
      let bestId = null;
      for (const originName of outputMeta.idOrigins) {
        const originId = `${ATTRIBUTE_SHARD_PREFIX}${originName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
        const originMeta = metaById.get(originId);
        if (!originMeta) continue;
        const originUnit = buyOrderPrice(payload[originId]);
        if (!originUnit) continue;
        const q1 = fusionInputQty(originMeta);
        const q2 = cheapestAny.qty;
        const evalPlan = evaluateShardPlan(payload, outputMeta.shardId, 1, [
          { productId: originMeta.shardId, qty: q1 },
          { productId: cheapestAny.meta.shardId, qty: q2 }
        ]);
        if (!evalPlan) continue;
        const plan = {
          method: 'ID',
          inputsLabel: `Slot 1: ${q1}x ${originMeta.name} (${formatPer(originUnit)} ea), Slot 2: ${q2}x ${cheapestAny.meta.name} (${formatPer(cheapestAny.unit)} ea)`,
          netCost: evalPlan.netCost,
          outputSell: evalPlan.outputSell,
          profit: evalPlan.profit,
          margin: evalPlan.margin,
          totalWaitHours: evalPlan.totalWaitHours,
          liquidityScore: evalPlan.liquidityScore
        };
        if (!bestId || plan.profit > bestId.profit) bestId = plan;
      }
      if (bestId) candidates.push(bestId);
    }

    // Chameleon Fusion: chameleon + second-input shard where output is in next-3 ID sequence.
    if (chameleon && chameleonBO && Number.isFinite(outputMeta.id)) {
      let bestChameleon = null;
      const validIds = new Set([outputMeta.id - 1, outputMeta.id - 2, outputMeta.id - 3]);
      for (const secondMeta of liveMetas) {
        if (secondMeta.rarity !== outputMeta.rarity) continue;
        if (!validIds.has(secondMeta.id)) continue;
        const secondUnit = buyOrderPrice(payload[secondMeta.shardId]);
        if (!secondUnit) continue;
        const q2 = fusionInputQty(secondMeta);
        const evalPlan = evaluateShardPlan(payload, outputMeta.shardId, 1, [
          { productId: chameleon.shardId, qty: 1 },
          { productId: secondMeta.shardId, qty: q2 }
        ]);
        if (!evalPlan) continue;
        const plan = {
          method: 'Chameleon',
          inputsLabel: `Slot 1: 1x ${chameleon.name} (${formatPer(chameleonBO)} ea), Slot 2: ${q2}x ${secondMeta.name} (${formatPer(secondUnit)} ea)`,
          netCost: evalPlan.netCost,
          outputSell: evalPlan.outputSell,
          profit: evalPlan.profit,
          margin: evalPlan.margin,
          totalWaitHours: evalPlan.totalWaitHours,
          liquidityScore: evalPlan.liquidityScore
        };
        if (!bestChameleon || plan.profit > bestChameleon.profit) bestChameleon = plan;
      }
      if (bestChameleon) candidates.push(bestChameleon);
    }

    if (!candidates.length) return;
    candidates.sort((a, b) => b.profit - a.profit);
    const best = candidates[0];
    rows.push({
      name: outputMeta.name,
      outputId: outputMeta.shardId,
      category: `Attribute Fusion (${best.method})`,
      inputsLabel: best.inputsLabel,
      netCost: best.netCost,
      outputSell: best.outputSell,
      profit: best.profit,
      margin: best.margin,
      totalWaitHours: best.totalWaitHours,
      liquidityScore: best.liquidityScore
    });
  });

  rows.sort((a, b) => {
    const aScore = (a.profit || 0) / Math.max(1, a.totalWaitHours || 1);
    const bScore = (b.profit || 0) / Math.max(1, b.totalWaitHours || 1);
    if (bScore !== aScore) return bScore - aScore;
    return (b.profit || 0) - (a.profit || 0);
  });
  return rows.filter((row) => {
    if (Number.isFinite(row.totalWaitHours) && row.totalWaitHours > MAX_TOTAL_WAIT_HOURS) return false;
    if (Number.isFinite(row.liquidityScore) && row.liquidityScore < MIN_LIQUIDITY_MULTIPLE) return false;
    return true;
  });
}

function fusionInputQty(meta) {
  if (!meta) return 5;
  const name = String(meta.name || '').toUpperCase();
  if (name === 'CHAMELEON') return 1;
  const family = String(meta.family || '').toUpperCase();
  if (REPTILE_FAMILY_KEYWORDS.some((k) => family.includes(k))) return 2;
  return 5;
}

function parseFusionCondition(raw) {
  const text = String(raw || '').toUpperCase().replace(/[\u2013\u2014]/g, '-').trim();
  if (!text || text === '-') return [];
  const normalized = text
    .replace(/\u27E6AND\u27E7/g, ' AND ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = normalized.split(/\s+AND\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.map((part) => {
    const token = part.replace(/^ANY\s+/, '').trim();
    if (token.endsWith('+')) {
      return { type: 'rarity_min', value: token.slice(0, -1).trim() };
    } else if (SHARD_CATEGORIES.has(token)) {
      return { type: 'category', value: token };
    } else if (RARITY_RANK[token]) {
      return { type: 'rarity', value: token };
    } else {
      return { type: 'family', value: token };
    }
  });
}

function shardMatchesConditions(meta, conditions) {
  return conditions.every((cond) => {
    if (cond.type === 'category') {
      return String(meta.category || '').toUpperCase() === cond.value;
    } else if (cond.type === 'rarity') {
      return String(meta.rarity || '').toUpperCase() === cond.value;
    } else if (cond.type === 'rarity_min') {
      const current = RARITY_RANK[String(meta.rarity || '').toUpperCase()] || 0;
      const min = RARITY_RANK[cond.value] || 0;
      return current >= min && min > 0;
    } else {
      return String(meta.family || '').toUpperCase().includes(cond.value);
    }
  });
}

function cheapestMatchingInput(condition, metas, payload) {
  const conditions = parseFusionCondition(condition);
  if (!conditions.length) return null;
  const priced = metas
    .filter((meta) => shardMatchesConditions(meta, conditions))
    .map((meta) => {
      const unit = buyOrderPrice(payload[meta.shardId]);
      if (!unit) return null;
      const qty = fusionInputQty(meta);
      return { meta, unit, qty, cost: unit * qty };
    })
    .filter(Boolean)
    .sort((a, b) => a.cost - b.cost);
  return priced[0] || null;
}

function applyTheme() {
  document.body.classList.toggle('theme-glass', state.darkMode);
  const btn = document.getElementById('theme-toggle');
  btn.textContent = `Dark Glass: ${state.darkMode ? 'On' : 'Off'}`;
}

async function fetchJsonFromAny(urls) {
  for (const url of urls) {
    try {
      const resp = await fetch(url);
      const contentType = resp.headers.get('content-type') || '';
      if (!resp.ok || !contentType.includes('application/json')) continue;
      const data = await resp.json();
      if (data?.error) continue;
      return data;
    } catch {
      // try next source
    }
  }
  return null;
}

async function fetchItemMap(outputIds) {
  if (!outputIds.length) return {};
  const requested = new Set(outputIds);
  const fetchItems = async (url) => fetchJsonFromAny([url]);

  const useAllItems = outputIds.length > 160;
  const directItemsUrl = 'https://api.hypixel.net/resources/skyblock/items';
  let items = await fetchItems(useAllItems
    ? '/api/items'
    : `/api/items?ids=${encodeURIComponent(outputIds.join(','))}`);
  if (!items) {
    const full = await fetchItems(directItemsUrl);
    if (Array.isArray(full?.items)) {
      items = useAllItems
        ? full.items
        : full.items.filter((item) => requested.has(item.id));
    }
  }
  if (!items) return {};

  let map = buildIconMap(items);
  const missing = outputIds.filter((id) => !map[id]);
  if (missing.length > 0 && !useAllItems) {
    const allItems = await fetchItems('/api/items');
    if (Array.isArray(allItems)) {
      const filtered = allItems.filter((item) => requested.has(item.id));
      map = buildIconMap(filtered);
    } else if (Array.isArray(allItems?.items)) {
      const filtered = allItems.items.filter((item) => requested.has(item.id));
      map = buildIconMap(filtered);
    }
  }
  return map;
}

function renderForgeTable() {
  const tbody = document.querySelector('#forge-table tbody');
  tbody.innerHTML = '';
  state.forgeRows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${getItemCell(row.name, row.outputId)}</td>
      <td>${row.category}</td>
      <td>${row.inputsLabel}</td>
      <td>${row.extraLabel}</td>
      <td>${formatNum(row.netCost)}</td>
      <td>${formatNum(row.outputSell)}</td>
      <td>${formatNum(row.profit)}</td>
      <td>${formatNum(row.profitPerHour)}</td>
      <td>${row.forgeHours}h</td>
      <td>${row.hotm != null ? `HOTM ${row.hotm}` : '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCraftTable() {
  const tbody = document.querySelector('#craft-table tbody');
  tbody.innerHTML = '';
  state.craftRows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${getItemCell(row.name, row.outputId)}</td>
      <td>${row.inputsLabel}</td>
      <td>${formatNum(row.netCost)}</td>
      <td>${formatNum(row.outputSell)}</td>
      <td>${formatNum(row.profit)}</td>
      <td>${formatPer(row.margin)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderShardTable() {
  const container = document.getElementById('shard-cards');
  container.innerHTML = '';
  state.shardRows.forEach((row) => {
    const card = document.createElement('article');
    const waitText = Number.isFinite(row.totalWaitHours) ? `${formatPer(row.totalWaitHours)}h est.` : '-';
    card.className = 'shard-fusion-card';
    card.innerHTML = `
      <div class="shard-card-head">
        ${getItemCell(row.name, row.outputId)}
        <span class="shard-method">${row.category}</span>
      </div>
      <p class="shard-inputs"><strong>Inputs:</strong> ${row.inputsLabel}</p>
      <div class="shard-stats">
        <p><span>Fusion Cost</span><strong>${formatNum(row.netCost)}</strong></p>
        <p><span>Output Net</span><strong>${formatNum(row.outputSell)}</strong></p>
        <p><span>Profit</span><strong>${formatNum(row.profit)}</strong></p>
        <p><span>Margin</span><strong>${formatPer(row.margin)}%</strong></p>
        <p><span>Est. Wait</span><strong>${waitText}</strong></p>
      </div>
    `;
    container.appendChild(card);
  });
}

function enableShardCardPointerFx() {
  const cards = document.querySelectorAll('.shard-fusion-card');
  cards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mx', `${x}px`);
      card.style.setProperty('--my', `${y}px`);
    });
    card.addEventListener('mouseleave', () => {
      card.style.setProperty('--mx', '50%');
      card.style.setProperty('--my', '0%');
    });
  });
}

function startShardTypewriter() {
  const el = document.getElementById('shard-typewriter');
  if (!el) return;
  const lines = [
    'Calculating best fusion path...',
    'Checking liquidity and fill speed...',
    'Ranking net profit after tax...',
    'Ready: high-confidence shard flips loaded.'
  ];
  let line = 0;
  let i = 0;
  let deleting = false;

  const tick = () => {
    const current = lines[line];
    if (!deleting) {
      i += 1;
      el.textContent = current.slice(0, i);
      if (i >= current.length) {
        deleting = true;
        setTimeout(tick, 1200);
        return;
      }
      setTimeout(tick, 38);
    } else {
      i -= 1;
      el.textContent = current.slice(0, Math.max(0, i));
      if (i <= 0) {
        deleting = false;
        line = (line + 1) % lines.length;
      }
      setTimeout(tick, 20);
    }
  };
  tick();
}

function renderSummary() {
  const cardsEl = document.getElementById('summary-cards');
  const rows = state.activeTab === 'forge'
    ? state.forgeRows
    : state.activeTab === 'craft'
      ? state.craftRows
      : state.shardRows;
  cardsEl.innerHTML = '';
  rows.slice(0, 3).forEach((row) => {
    const card = document.createElement('article');
    card.className = 'summary-card';
    const modeLine = state.activeTab === 'forge'
      ? `Profit/h: ${formatNum(row.profitPerHour)}`
      : `Margin: ${formatPer(row.margin)}%`;
    const categoryLabel = state.activeTab === 'forge' ? row.category : state.activeTab === 'craft' ? 'Craft' : (row.category || 'Shard Fusion');
    card.innerHTML = `
      <h3>${row.name}</h3>
      <p><strong>${categoryLabel}</strong></p>
      <p>Input cost: ${formatNum(row.netCost)}</p>
      <p>Output: ${formatNum(row.outputSell)}</p>
      <p>Profit: ${formatNum(row.profit)}</p>
      <p>${modeLine}</p>
    `;
    cardsEl.appendChild(card);
  });
}

function applyCraftFilters() {
  const filtered = state.allCraftRows.filter((row) => {
    if (state.hideGemCrafts && row.craftType === 'gemstone') return false;
    return true;
  });
  state.craftRows = filtered.slice(0, state.craftLimit);
}

function setActiveTab(tab) {
  state.activeTab = tab;
  document.getElementById('tab-forge').classList.toggle('active', tab === 'forge');
  document.getElementById('tab-craft').classList.toggle('active', tab === 'craft');
  document.getElementById('tab-shard').classList.toggle('active', tab === 'shard');
  document.getElementById('forge-panel').classList.toggle('hidden', tab !== 'forge');
  document.getElementById('craft-panel').classList.toggle('hidden', tab !== 'craft');
  document.getElementById('shard-panel').classList.toggle('hidden', tab !== 'shard');
  renderSummary();
}

async function loadPrices() {
  const status = document.getElementById('status');
  const updatedAt = document.getElementById('updated-at');

  try {
    status.textContent = 'Loading live bazaar prices...';
    const [bazaarData, attrPayload, forgeResp] = await Promise.all([
      fetchJsonFromAny(['/api/prices', 'https://api.hypixel.net/v2/skyblock/bazaar']),
      fetchJsonFromAny(['/api/attributes']),
      fetchForgeConfigs()
    ]);
    if (!bazaarData) {
      throw new Error('Unable to load bazaar prices from API sources.');
    }
    const payload = bazaarData.products ? bazaarData.products : bazaarData;
    if (!payload || typeof payload !== 'object') {
      throw new Error('Bazaar data payload is invalid.');
    }
    state.lastPayload = payload;
    state.attributeShards = Array.isArray(attrPayload?.shards) ? attrPayload.shards : [];
    state.forgeConfigs = Array.isArray(forgeResp) ? forgeResp : [];
    state.forgeRows = buildForgeRows(payload, state.forgeConfigs);
    state.allCraftRows = buildCraftRows(payload);
    state.shardRows = buildShardRows(payload);
    applyCraftFilters();
    const outputIds = [...new Set([...state.forgeRows, ...state.craftRows, ...state.shardRows].map((row) => row.outputId))];
    state.iconMap = await fetchItemMap(outputIds);
    const attributeIconMap = buildAttributeIconMap(state.attributeShards);
    state.iconMap = { ...state.iconMap, ...attributeIconMap };

    renderForgeTable();
    renderCraftTable();
    renderShardTable();
    enableShardCardPointerFx();
    renderSummary();

    updatedAt.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    const bestCraft = state.craftRows[0];
    const bestShard = state.shardRows[0];
    const craftText = bestCraft ? `Best craft: ${bestCraft.name} (${formatNum(bestCraft.profit)}).` : 'No craft flips available.';
    const shardText = bestShard ? `Best shard: ${bestShard.name} (${formatNum(bestShard.profit)}).` : 'No shard fusions available.';
    const modeText = state.allowMiddleCraft ? 'middle-crafting ON' : 'middle-crafting OFF';
    const inputModeText = state.inputPriceMode === 'buyorder' ? 'Buy-Order inputs' : 'Insta-Buy inputs';
    status.textContent = `${state.forgeRows.length} forge flips, ${state.craftRows.length}/${state.allCraftRows.length} craft flips, ${state.shardRows.length} shard fusions. ${inputModeText}, ${modeText}. ${craftText} ${shardText}`;
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    document.querySelector('#forge-table tbody').innerHTML = '';
    document.querySelector('#craft-table tbody').innerHTML = '';
    document.getElementById('shard-cards').innerHTML = '';
    document.getElementById('summary-cards').innerHTML = '';
    console.error(err);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tab-forge').addEventListener('click', () => setActiveTab('forge'));
  document.getElementById('tab-craft').addEventListener('click', () => setActiveTab('craft'));
  document.getElementById('tab-shard').addEventListener('click', () => setActiveTab('shard'));
  document.getElementById('refresh-btn').addEventListener('click', loadPrices);
  document.getElementById('craft-limit').addEventListener('change', (e) => {
    state.craftLimit = Number(e.target.value) || 25;
    applyCraftFilters();
    renderCraftTable();
    renderSummary();
  });
  document.getElementById('hide-gem-crafts').addEventListener('change', (e) => {
    state.hideGemCrafts = !!e.target.checked;
    applyCraftFilters();
    renderCraftTable();
    renderSummary();
  });
  document.getElementById('allow-middle-craft').addEventListener('change', async (e) => {
      state.allowMiddleCraft = !!e.target.checked;
      if (state.lastPayload) {
        state.allCraftRows = buildCraftRows(state.lastPayload);
        state.forgeRows = buildForgeRows(state.lastPayload, state.forgeConfigs);
        applyCraftFilters();
        renderForgeTable();
        renderCraftTable();
        renderSummary();
      } else {
      await loadPrices();
    }
  });
  document.getElementById('input-price-mode').addEventListener('change', (e) => {
    state.inputPriceMode = String(e.target.value || 'instabuy');
    if (state.lastPayload) {
      state.forgeRows = buildForgeRows(state.lastPayload, state.forgeConfigs);
      state.allCraftRows = buildCraftRows(state.lastPayload);
      state.shardRows = buildShardRows(state.lastPayload);
      applyCraftFilters();
      renderForgeTable();
      renderCraftTable();
      renderShardTable();
      enableShardCardPointerFx();
      renderSummary();
      const status = document.getElementById('status');
      const modeText = state.inputPriceMode === 'buyorder' ? 'Buy-Order' : 'Insta-Buy';
      status.textContent = `Recalculated using ${modeText} input mode.`;
    }
  });
  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.darkMode = !state.darkMode;
    applyTheme();
  });
  applyTheme();
  setActiveTab('forge');
  startShardTypewriter();
  loadPrices();
});


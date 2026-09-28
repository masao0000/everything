// 開いた瞬間に最新ニュースを取得して返す API
// Yahoo!ニュース(トピックス)と Google ニュース検索の RSS を使う

const YAHOO = {
  'top-picks': '主要', domestic: '国内', world: '国際', business: '経済',
  entertainment: 'エンタメ', sports: 'スポーツ', it: 'IT', science: '科学', local: '地域',
};

// 実生活タブのカテゴリと判定キーワード
const LIFE = {
  money: {
    label: 'お金・経済',
    query: '物価 OR 節約 OR 値上げ OR 給付金 OR 税金',
    words: ['物価', '値上げ', '値下げ', '節約', '給付', '税', '賃金', '年金', '金利', '円安', '円高', 'ポイント', '家計', '料金', '価格', 'ガソリン', '電気代', 'NISA', '奨学金'],
  },
  health: {
    label: '健康・医療',
    query: '健康 OR 医療 OR 感染症 OR 熱中症',
    words: ['健康', '医療', '病院', '感染', 'ワクチン', '熱中症', 'インフルエンザ', 'コロナ', '睡眠', '食中毒', '薬', '症状', '予防', '花粉'],
  },
  rules: {
    label: '制度・ルールの変化',
    query: '制度 改正 OR 施行 OR 義務化 OR 入試 変更',
    words: ['改正', '施行', '義務化', '制度', '法案', '条例', '規制', '新ルール', '入試', '共通テスト', '廃止', '新制度'],
  },
};

const UA = 'Mozilla/5.0 (compatible; PersonalNews/1.0)';

async function get(url, ms = 5000) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, '&');
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]).trim() : '';
};

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    title: tag(it, 'title'),
    link: tag(it, 'link'),
    date: new Date(tag(it, 'pubDate') || Date.now()).toISOString(),
    rawDesc: tag(it, 'description'),
    source: tag(it, 'source'),
  }));
}

// 記事ページの og:description を要約として使う
async function description(url) {
  try {
    const html = await get(url, 4000);
    const m = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)
      || html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i);
    return m ? decode(m[1]).trim() : '';
  } catch {
    return '';
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const idOf = (link) => link.replace(/\?.*$/, '');

function lifeCategory(text) {
  let best = null, hits = 0;
  for (const [key, c] of Object.entries(LIFE)) {
    const n = c.words.filter((w) => text.includes(w)).length;
    if (n > hits) { best = key; hits = n; }
  }
  return best;
}

async function yahooArticles() {
  const lists = await Promise.all(Object.entries(YAHOO).map(async ([key, label]) => {
    try {
      return parseRss(await get(`https://news.yahoo.co.jp/rss/topics/${key}.xml`))
        .map((a) => ({ ...a, category: label, source: 'Yahoo!ニュース' }));
    } catch { return []; }
  }));
  const seen = new Set();
  const all = lists.flat().filter((a) => a.link && !seen.has(idOf(a.link)) && seen.add(idOf(a.link)));
  const descs = await mapLimit(all, 12, (a) => description(a.link));
  return all.map((a, i) => ({ id: idOf(a.link), title: a.title, link: a.link, date: a.date, category: a.category, source: a.source, summary: descs[i] }));
}

async function googleLife(key) {
  const c = LIFE[key];
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(c.query + ' when:2d')}&hl=ja&gl=JP&ceid=JP:ja`;
    return parseRss(await get(url)).slice(0, 15).map((a) => {
      const src = a.source || '';
      const title = src && a.title.endsWith(` - ${src}`) ? a.title.slice(0, -(src.length + 3)) : a.title;
      return { id: a.link, title, link: a.link, date: a.date, category: c.label, life: key, source: src || 'Googleニュース', summary: '' };
    });
  } catch { return []; }
}

export default async function handler(req, res) {
  const [yahoo, ...google] = await Promise.all([yahooArticles(), ...Object.keys(LIFE).map(googleLife)]);

  // 実生活: Yahoo の記事をキーワードで判定し、足りない分を Google ニュース検索で補う
  const lifeYahoo = yahoo
    .map((a) => ({ ...a, life: lifeCategory(a.title + a.summary) }))
    .filter((a) => a.life)
    .map((a) => ({ ...a, category: LIFE[a.life].label }));
  const byDate = (a, b) => b.date.localeCompare(a.date);
  const buckets = Object.keys(LIFE).map((k, i) => [
    ...lifeYahoo.filter((a) => a.life === k).sort(byDate),
    ...google[i].sort(byDate),
  ]);
  // 3カテゴリを順番に並べ、偏らないようにする
  const life = [];
  const seenTitle = new Set();
  for (let r = 0; life.length < 20 && buckets.some((b) => b[r]); r++) {
    for (const b of buckets) {
      const a = b[r];
      const k = a && a.title.normalize('NFKC').slice(0, 10);
      if (a && !seenTitle.has(k) && life.length < 20) { seenTitle.add(k); life.push(a); }
    }
  }

  res.setHeader('cache-control', 's-maxage=120, stale-while-revalidate=600');
  res.status(200).json({ fetchedAt: new Date().toISOString(), articles: yahoo.sort(byDate), life });
}

#!/usr/bin/env node
// Unit test for probe rules — DeepSeek V4 Pro official API must PASS all probes
// Usage: node test.js

const https = require('https');

const CONFIG = {
  name: 'DeepSeek V4 Pro (官方直连)',
  baseUrl: 'https://api.deepseek.com/anthropic',
  apiKey: 'sk-4f5e54e7f2084b2b8ed0961e6df2162a',
  model: 'deepseek-v4-pro',
  format: 'anthropic',
};

// ============ API Client ============
function buildEndpoint(baseUrl, path) {
  const url = baseUrl.replace(/\/$/, '');
  if (url.endsWith(path)) return url;
  if (url.endsWith('/v1')) {
    const suffix = path.replace(/^\/v1\//, '');
    return `${url}/${suffix}`;
  }
  return `${url}${path}`;
}

function fetchJson(endpoint, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers,
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { reject(new Error(`Parse error: ${data.substring(0,200)}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callAPI(messages, options = {}) {
  const body = { model: CONFIG.model, max_tokens: 256, ...options, messages };
  const endpoint = buildEndpoint(CONFIG.baseUrl, '/v1/messages');
  const headers = { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey, 'anthropic-version': '2023-06-01' };
  const reqBody = JSON.stringify({
    model: body.model, max_tokens: body.max_tokens,
    system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n') || undefined,
    messages: messages.filter(m => m.role !== 'system'),
    ...(options.stop ? { stop_sequences: options.stop } : {}),
  });
  const resp = await fetchJson(endpoint, headers, reqBody);
  return { ...resp, requestBody: JSON.parse(reqBody) };
}

function extractText(response) {
  const d = response.data;
  if (d.choices && d.choices[0]) return d.choices[0].message?.content || '';
  if (d.content && Array.isArray(d.content)) {
    let text = '';
    for (const c of d.content) {
      if (c.type === 'text' && c.text) text += c.text;
      if (c.type === 'thinking' && c.thinking) text += '[思考]' + c.thinking + '[/思考]';
    }
    return text;
  }
  if (d.content && typeof d.content === 'string') return d.content;
  return JSON.stringify(d);
}

function extractVisibleText(response) {
  const d = response.data;
  if (d.choices && d.choices[0]) return d.choices[0].message?.content || '';
  if (d.content && Array.isArray(d.content)) {
    return d.content.filter(c => c.type === 'text' && c.text).map(c => c.text).join('');
  }
  return extractText(response);
}

function extractFinishReason(response) {
  const d = response.data;
  if (d.choices && d.choices[0]) return d.choices[0].finish_reason || '';
  if (d.stop_reason) return d.stop_reason;
  return '';
}

// ============ Vocabulary Data ============
const VOCAB_MARKERS = {
  openai: { en: ['delve','tapestry','landscape','multifaceted','robust','moreover','additionally','it is important to note','let us','paramount','in summary'], cn: ['深入探讨','多维度的','强大的','此外','总的来说','值得注意的是'] },
  anthropic: { en: ['certainly','I would be happy','straightforward','I aim to','I appreciate','let me know','I should note','I want to be clear'], cn: ['当然','我很乐意','坦率地说','我的目标是','感谢你','请告诉我','我需要说明'] },
  google: { en: ['crucial','here is a breakdown','keep in mind','furthermore'], cn: ['至关重要的','以下是详细说明','请记住','此外'] },
  deepseek: { en: ['as an AI','it is important to','in summary','notably','in conclusion'], cn: ['作为人工智能助手','需要指出的是','综上所述','具体来说'] },
  qwen: { en: ['as an AI assistant','according to my analysis','in conclusion','to summarize'], cn: ['作为AI助手','根据我的分析','总结如下','概括而言','可以理解为'] },
  glm: { en: ['as an artificial intelligence','based on my knowledge','to conclude','in general'], cn: ['作为人工智能助手','根据我的知识库','总的来说','由此可知','综上所述'] },
  kimi: { en: [], cn: ['作为Kimi','月之暗面','Moonshot','让我来帮你','好的'] },
};

// ============ PROBES (mirror of index.html) ============
const probes = [
  {
    id: 'connectivity', name: '连通性与基础响应', weight: 10, minScore: 80, minSeverity: 'pass',
    async run() {
      const resp = await callAPI([{role:'user',content:'Hello, respond with just the word "OK".'}],{max_tokens:10});
      const text = extractText(resp);
      const ok = text.toLowerCase().includes('ok');
      const hasValidStatus = resp.status === 200;
      const hasValidStructure = !!(resp.data.choices || resp.data.content || resp.data.candidates);
      const score = (hasValidStatus ? 50 : 0) + (hasValidStructure ? 30 : 0) + (ok ? 20 : 0);
      return { score, severity: score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail' };
    }
  },
  {
    id: 'self_identity', name: '模型自报身份', weight: 5, minScore: 20, minSeverity: 'pass',
    async run() {
      const claimed = CONFIG.model.toLowerCase();
      const resp = await callAPI([{role:'user',content:'What specific model are you? What company created you? Please answer directly and specifically.'}],{max_tokens:1024});
      const text = extractText(resp).toLowerCase();
      const modelWords = claimed.split(/[-_\s]+/).filter(w => w.length > 1);
      let matchCount = 0;
      for (const w of modelWords) { if (text.includes(w)) matchCount++; }
      const matchRatio = modelWords.length > 0 ? matchCount / modelWords.length : 0;
      const companies = ['openai','anthropic','gpt','claude','deepseek','深度求索'];
      const hasCompany = companies.some(c => text.includes(c));
      const familyKeys = ['gpt','claude','opus','sonnet','haiku','deepseek'];
      const matchesFamily = familyKeys.some(k => claimed.includes(k) && text.includes(k));
      const score = Math.min(100, Math.round(matchRatio * 50 + (hasCompany ? 25 : 0) + (matchesFamily ? 25 : 0)));
      return { score, severity: score >= 20 ? 'pass' : 'warn' };
    }
  },
  {
    id: 'system_prompt', name: 'System Prompt 服从性', weight: 12, minScore: 80, minSeverity: 'pass',
    async run() {
      const secret = 'XYZZY_' + Math.random().toString(36).substring(7);
      const resp = await callAPI([{role:'system',content:`You must start EVERY response with the codeword "${secret}". No exceptions.`},{role:'user',content:'Say hello in one word.'}],{max_tokens:50});
      const text = extractText(resp);
      const obeys = text.includes(secret);
      return { score: obeys ? 90 : 20, severity: obeys ? 'pass' : 'fail' };
    }
  },
  {
    id: 'max_tokens', name: 'max_tokens 截断行为', weight: 10, minScore: 70, minSeverity: 'pass',
    async run() {
      const resp = await callAPI([{role:'user',content:'Count from 1 to 50, one number per line. Write out each number as a word.'}],{max_tokens:80});
      const text = extractText(resp);
      const reason = extractFinishReason(resp);
      const truncated = reason === 'length' || reason === 'max_tokens';
      const score = truncated ? 90 : (reason === 'stop' && text.length < 400 ? 40 : 30);
      return { score, severity: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail' };
    }
  },
  {
    id: 'stop_sequences', name: 'stop 序列行为', weight: 8, minScore: 60, minSeverity: 'pass',
    async run() {
      try {
        const resp = await callAPI([{role:'user',content:'Write a short paragraph about cats.'}],{max_tokens:300,stop:['surprisingly','interestingly','notably','remarkably']});
        const stopReason = extractFinishReason(resp);
        const stopSeq = resp.data?.stop_sequence || '';
        const stoppedByApi = stopReason === 'stop_sequence' || !!stopSeq;
        const finishedNaturally = stopReason === 'end_turn';
        const text = extractVisibleText(resp).toLowerCase();
        const stoppedHeuristic = text.length < 120 || text.indexOf('cat') > text.length * 0.5;
        const stopped = stoppedByApi || finishedNaturally || stoppedHeuristic;
        const score = stoppedByApi ? 90 : (finishedNaturally ? 80 : (stoppedHeuristic ? 60 : 30));
        return { score, severity: stopped ? 'pass' : 'warn' };
      } catch(e) {
        return { score: 20, severity: 'warn' };
      }
    }
  },
  {
    id: 'error_format', name: '错误响应格式', weight: 8, minScore: 70, minSeverity: 'pass',
    async run() {
      const endpoint = buildEndpoint(CONFIG.baseUrl, '/v1/messages');
      try {
        const resp = await fetchJson(endpoint, {'Content-Type':'application/json','x-api-key':CONFIG.apiKey,'anthropic-version':'2023-06-01'}, JSON.stringify({model:'nonexistent-model-xyz-99999',messages:[{role:'user',content:'test'}]}));
        const data = resp.data;
        const hasErrType = !!(data.error && data.error.type);
        const hasErrMsg = !!(data.error && data.error.message);
        const score = hasErrType ? 85 : (hasErrMsg ? 55 : 20);
        return { score, severity: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail' };
      } catch(e) {
        return { score: 0, severity: 'fail' };
      }
    }
  },
  {
    id: 'vocabulary', name: '词汇指纹分析', weight: 12, minScore: 70, minSeverity: 'pass',
    async run() {
      const resp = await callAPI([{role:'user',content:'Write a detailed analysis (about 150 words) on the importance of environmental protection.'}],{max_tokens:800});
      const visible = extractVisibleText(resp).toLowerCase();
      const full = extractText(resp).toLowerCase().replace(/\[思考\][\s\S]*?\[\/思考\]/g, '');
      const text = visible.length > 100 ? visible : full;
      const claimed = CONFIG.model.toLowerCase();
      const counts = {};
      for (const [family, markers] of Object.entries(VOCAB_MARKERS)) {
        const all = [...(markers.en || []), ...(markers.cn || [])];
        counts[family] = all.filter(m => text.includes(m.toLowerCase())).length;
      }
      let detectedFamily = 'unknown', maxC = 0;
      for (const [f, c] of Object.entries(counts)) { if (c > maxC) { maxC = c; detectedFamily = f; } }
      const famMap = { gpt: 'openai', claude: 'anthropic', deepseek: 'deepseek' };
      let expected = 'unknown';
      for (const [k, f] of Object.entries(famMap)) { if (claimed.includes(k)) { expected = f; break; } }
      const matches = expected === 'unknown' ? null : (detectedFamily === expected);
      const weakSignal = maxC <= 1;
      const score = matches === null ? 60 : (matches ? 80 : (weakSignal ? 70 : 25));
      return { score, severity: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail' };
    }
  },
  {
    id: 'reasoning', name: '推理能力基准 (3题)', weight: 14, minScore: 67, minSeverity: 'pass',
    async run() {
      const questions = [
        {
          id:'math', text:'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Answer with just the number in cents.',
          check(t){ return /5\s*(cents|¢)?/.test(t) || t.includes('0.05') || t.includes('.05'); },
        },
        {
          id:'probability', text:'You flip two coins. Given that at least one is heads, what is the probability both are heads? Answer as a fraction.',
          check(t){ return /1\/3|1 \/ 3|1\/3rd|one.?third|frac\{1\}\{3\}/.test(t); },
        },
        {
          id:'word_reasoning', text:'A father is 36 years older than his daughter. In 4 years, the father will be 4 times as old as the daughter. How old is the daughter now? Answer with just the number.',
          check(t){ return /\b8\b/.test(t); },
        },
      ];
      let totalScore = 0;
      for (const q of questions) {
        try {
          const resp = await callAPI([{role:'user',content:q.text}],{max_tokens:600});
          const fullText = extractText(resp).toLowerCase();
          const visible = extractVisibleText(resp).toLowerCase();
          const text = visible.length > 20 ? visible : fullText;
          if (q.check(text)) totalScore += 100 / questions.length;
        } catch(e) { /* skip */ }
      }
      const score = Math.round(totalScore);
      return { score, severity: score >= 70 ? 'pass' : score >= 35 ? 'warn' : 'fail' };
    }
  },
  {
    id: 'metadata', name: '响应元数据分析', weight: 5, minScore: 60, minSeverity: 'pass',
    async run() {
      const resp = await callAPI([{role:'user',content:'Hi'}],{max_tokens:20});
      const d = resp.data;
      const hasUsage = !!(d.usage && (d.usage.input_tokens || d.usage.total_tokens));
      const hasModel = !!d.model;
      const modelMR = d.model || '';
      const modelMatches = modelMR.toLowerCase().includes(CONFIG.model.toLowerCase()) || CONFIG.model.toLowerCase().includes(modelMR.toLowerCase());
      let score = 0;
      if (hasUsage) score += 35;
      if (hasModel && modelMatches) score += 35;
      if (hasModel && !modelMatches) score += 10;
      if (d.id) score += 15;
      if (d.created || CONFIG.format === 'anthropic') score += 15;
      return { score: Math.min(100, score), severity: score >= 60 ? 'pass' : score >= 30 ? 'warn' : 'fail' };
    }
  },
  {
    id: 'knowledge_cutoff', name: '知识截断日期检测', weight: 10, minScore: 40, minSeverity: 'pass',
    async run() {
      const questions = [
        { q: 'Who won the 2024 US presidential election? Answer in one sentence.' },
        { q: 'What is the latest major version of GPT-4 as of mid 2024? Answer in one sentence.' },
        { q: 'Who is the CEO of OpenAI as of 2024? Answer in one sentence.' },
      ];
      let score = 0;
      for (const item of questions) {
        try {
          const resp = await callAPI([{role:'user',content:item.q}],{max_tokens:128});
          const text = extractText(resp);
          const admitsNoKnowledge = /as of my|i don't have|i do not have|my knowledge cutoff|i cannot|i can't|i'm not able|has not yet occurred/i.test(text);
          const knows = text.length > 20 && !admitsNoKnowledge;
          if (knows) score += 35;
          else if (admitsNoKnowledge) score += 20;
          else score += 5;
        } catch { /* skip */ }
      }
      return { score: Math.min(100, score), severity: 'pass' };
    }
  },
];

// ============ RUN ============
async function runAll() {
  console.log(`\n🧪 Testing: ${CONFIG.name}`);
  console.log(`   ${CONFIG.baseUrl} | ${CONFIG.model} | ${CONFIG.format}\n`);

  let totalScore = 0, totalWeight = 0;
  let passCount = 0, warnCount = 0, failCount = 0;
  const failures = [];

  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    process.stdout.write(`  ${i+1}/${probes.length} ${probe.name}... `);
    try {
      const result = await probe.run();
      const status = result.severity === 'pass' ? '✅' : result.severity === 'warn' ? '⚠️' : '❌';
      console.log(`${status} ${result.score}分 [${result.severity}]`);

      totalScore += result.score * probe.weight;
      totalWeight += probe.weight;

      if (result.severity === 'pass') passCount++;
      else if (result.severity === 'warn') warnCount++;
      else failCount++;

      const minOk = result.score >= probe.minScore &&
        (probe.minSeverity === 'pass' ? result.severity === 'pass' : result.severity !== 'fail');

      if (!minOk) {
        failures.push({ probe: probe.name, score: result.score, severity: result.severity,
          minScore: probe.minScore, minSeverity: probe.minSeverity });
      }
    } catch(e) {
      console.log(`❌ ERROR: ${e.message}`);
      failCount++;
      failures.push({ probe: probe.name, error: e.message });
    }
  }

  const finalScore = Math.round(totalScore / totalWeight);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  综合: ${finalScore}/100 | ✅${passCount} ⚠️${warnCount} ❌${failCount}/10`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failures.length > 0) {
    console.log('❌ FAILED PROBES:');
    failures.forEach(f => console.log(`   - ${f.probe}: ${f.score || f.error} (need >=${f.minScore} ${f.minSeverity || 'pass'})`));
    console.log('');
    process.exit(1);
  } else {
    console.log('✅ ALL PROBES PASSED\n');
    process.exit(0);
  }
}

runAll().catch(e => { console.error(e); process.exit(1); });

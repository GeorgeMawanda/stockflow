export function localSuggestions(report) {
  const suggestions = [];
  if (report.inventory.low_stock > 0) {
    suggestions.push({
      title: `${report.inventory.low_stock} item${report.inventory.low_stock === 1 ? '' : 's'} need attention`,
      detail: `Review low-stock items before your next supplier trip. Current stock cost value is ${Number(report.inventory.cost_value).toLocaleString('en-UG')} UGX; restock in line with cash available.`,
      category: 'Stock',
    });
  }
  if (Number(report.receivables.total) > 0) {
    suggestions.push({
      title: 'Follow up on customer balances',
      detail: `${Number(report.receivables.total).toLocaleString('en-UG')} UGX is outstanding across ${report.receivables.customers} customer${report.receivables.customers === 1 ? '' : 's'}. Review due balances before extending more credit.`,
      category: 'Cash flow',
    });
  }
  if (report.sales.count === 0) {
    suggestions.push({
      title: 'Start with a simple daily sales record',
      detail: 'Record cash and Mobile Money sales as they happen. A few days of complete records make stock and cash-flow patterns more useful.',
      category: 'Record keeping',
    });
  } else if (Number(report.sales.gross_profit) > 0) {
    suggestions.push({
      title: 'Review sales and estimated gross profit',
      detail: `This period has ${Number(report.sales.total).toLocaleString('en-UG')} UGX in recorded sales and ${Number(report.sales.gross_profit).toLocaleString('en-UG')} UGX estimated gross profit before other expenses.`,
      category: 'Sales',
    });
  }
  if (report.collections.length > 0) {
    const methods = report.collections
      .map((row) => `${row.method.replaceAll('_', ' ')} ${Number(row.total).toLocaleString('en-UG')} UGX`)
      .join(', ');
    suggestions.push({ title: 'Compare payment channels', detail: `Recorded collections: ${methods}. Reconcile Mobile Money confirmations with your provider statements.`, category: 'Payments' });
  }
  return suggestions;
}

export function getAiConfig(env = process.env) {
  return {
    configured: Boolean(env.AI_API_KEY && env.AI_MODEL),
    baseUrl: (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || '',
    timeoutMs: Math.min(30000, Math.max(1000, Number(env.AI_TIMEOUT_MS) || 12000)),
  };
}

export async function getAiSuggestion(report, question = '', env = process.env) {
  const config = getAiConfig(env);
  if (!config.configured) return { configured: false, text: null, warning: null };

  let endpoint;
  try {
    endpoint = new URL(`${config.baseUrl}/chat/completions`);
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
      throw new Error('AI_BASE_URL must use HTTPS');
    }
  } catch (error) {
    return { configured: true, text: null, warning: error.message };
  }

  const metrics = {
    period: report.period,
    sales: report.sales,
    collections: report.collections,
    inventory: report.inventory,
    receivables: report.receivables,
    daily: report.daily,
    topProducts: report.topProducts.map(({ quantity, revenue }) => ({ quantity, revenue })),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: 'You are a practical assistant for a small Ugandan shop. Use UGX. Give 2-4 concise, realistic actions based only on supplied aggregate business figures. Be cash-conscious; do not promise profit or offer regulated financial advice. Do not invent facts.' },
          { role: 'user', content: JSON.stringify({ question: question || 'Give practical stock, sales and cash-flow suggestions for this period.', aggregateBusinessFigures: metrics }) },
        ],
      }),
    });
    if (!response.ok) return { configured: true, text: null, warning: `AI provider returned HTTP ${response.status}.` };
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return { configured: true, text: null, warning: 'AI provider returned no suggestion.' };
    if (text.length > 4000) return { configured: true, text: null, warning: 'AI provider returned an overly long suggestion.' };
    return { configured: true, text: text.trim(), warning: null };
  } catch (error) {
    return { configured: true, text: null, warning: error.name === 'AbortError' ? 'AI provider timed out.' : 'AI provider could not be reached.' };
  } finally {
    clearTimeout(timer);
  }
}

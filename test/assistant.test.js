import test from 'node:test';
import assert from 'node:assert/strict';
import { getAiConfig, getAiSuggestion, localSuggestions } from '../src/assistant.js';

const report = {
  period: { from: '2026-10-01', to: '2026-10-14' },
  sales: { count: 2, total: 100000, gross_profit: 25000 },
  collections: [{ method: 'mtn_momo', total: 40000, count: 1 }],
  inventory: { products: 5, low_stock: 2, cost_value: 60000, retail_value: 90000 },
  receivables: { customers: 1, total: 30000 },
  daily: [],
  topProducts: [{ name: 'Private product name', quantity: 2, revenue: 100000 }],
};

test('suggestions give practical low-stock, credit, sales and Mobile Money advice', () => {
  const suggestions = localSuggestions(report);
  assert.equal(suggestions.length, 4);
  assert.match(suggestions[0].detail, /60,000 UGX/);
  assert.match(suggestions[1].detail, /30,000 UGX/);
  assert.match(suggestions[3].detail, /mtn momo 40,000 UGX/);
});

test('assistant recommends complete sales records when the period is empty', () => {
  const suggestions = localSuggestions({
    ...report, sales: { count: 0, total: 0, gross_profit: 0 },
    collections: [], inventory: { ...report.inventory, low_stock: 0 },
    receivables: { customers: 0, total: 0 },
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].category, 'Record keeping');
});

test('AI is explicitly unconfigured unless key and model are both present', async () => {
  assert.equal(getAiConfig({ AI_API_KEY: 'key' }).configured, false);
  assert.equal(getAiConfig({ AI_API_KEY: 'key', AI_MODEL: 'model' }).configured, true);
  assert.deepEqual(await getAiSuggestion(report, '', {}), { configured: false, text: null, warning: null });
});

test('configured AI requires a secure endpoint outside localhost', async () => {
  const result = await getAiSuggestion(report, '', {
    AI_API_KEY: 'test-key', AI_MODEL: 'test-model', AI_BASE_URL: 'http://example.com/v1',
  });
  assert.equal(result.configured, true);
  assert.match(result.warning, /HTTPS/);
});

test('AI request contains aggregates but excludes product names and raw customer data', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Check stock before your next order.' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const result = await getAiSuggestion(report, 'How can I manage cash?', {
      AI_API_KEY: 'test-only-key', AI_MODEL: 'test-model',
    });
    assert.equal(result.text, 'Check stock before your next order.');
    assert.equal(sentBody.messages[1].content.includes('Private product name'), false);
    assert.equal(sentBody.messages[1].content.includes('customer phone'), false);
    assert.match(sentBody.messages[1].content, /How can I manage cash/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

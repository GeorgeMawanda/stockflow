import { useState, useEffect, useCallback, useRef } from 'react';
import { api, apiBlob, fmt, getToken, prepareImage, setToken } from './api.js';

function useLoad(path, deps = []) {
  const [data, setData] = useState(null);
  const reload = useCallback(() => api(path).then(setData).catch(() => setData([])), [path]);
  useEffect(() => { reload(); }, [reload, ...deps]);
  return [data, reload];
}

function useRemoteImage(path, enabled, refresh = 0) {
  const [image, setImage] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true, objectUrl;
    setImage(null);
    setError('');
    if (!enabled) return () => { active = false; };
    apiBlob(path).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setImage(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch((x) => { if (active) setError(x.message); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, enabled, refresh]);
  return { image, error };
}

function ImageUploader({ label, value, remoteUrl, maxDimension = 960, onChange }) {
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setPreview(value ? `data:${value.contentType};base64,${value.data}` : remoteUrl || '');
  }, [value, remoteUrl]);
  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try { onChange(await prepareImage(file, maxDimension)); }
    catch (x) { setError(x.message); }
  };
  return <div className="image-uploader">
    <div className="image-preview">{preview ? <img src={preview} alt={`${label} preview`} /> : <span>Photo<br />preview</span>}</div>
    <div className="image-upload-controls">
      <label className="file-picker">{label}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choose} /></label>
      <span className="field-hint">Use your camera or choose a photo · JPG, PNG or WebP · max 512 KB after compression</span>
      {error && <span className="red upload-error" role="alert">{error}</span>}
    </div>
  </div>;
}

function ProductPhoto({ item, onChange }) {
  const element = useRef(null), [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!item.has_photo || visible || !element.current) return undefined;
    if (!window.IntersectionObserver) { setVisible(true); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [item.has_photo, visible]);
  const { image, error } = useRemoteImage(`/api/items/${item.id}/photo`, !!item.has_photo && visible);
  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await onChange(item, await prepareImage(file)); }
    catch (x) { onChange(null, null, x.message); }
  };
  return <span className="product-photo-control" ref={element}>
    <span className={`product-photo ${error ? 'photo-error' : ''}`}>
      {image ? <img src={image} alt={`${item.name} product`} /> : <span aria-hidden="true">{error ? '!' : '◇'}</span>}
    </span>
    <label className="photo-action" title={`Upload a photo for ${item.name}`}>Photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choose} /></label>
    {item.has_photo && <button type="button" className="photo-action remove-photo" onClick={() => onChange(item, null)}>Remove</button>}
  </span>;
}

function Auth({ onDone }) {
  const [mode, setMode] = useState('login'), [f, setF] = useState({ business: '', email: '', password: '' }), [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      const body = mode === 'login' ? { email: f.email, password: f.password } : f;
      setToken((await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body })).token); onDone();
    } catch (x) { setErr(x.message); }
  };
  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <div className="brand-lockup"><span className="brand-mark">S</span><span>StockFlow <span className="brand-region">UG</span></span></div>
        <div>
          <span className="eyebrow">A clearer view of your business</span>
          <h1>Run your shop.<br /><span>Know your numbers.</span></h1>
          <p>Keep stock, sales and customer balances moving together — all in one dependable workspace.</p>
        </div>
        <div className="auth-points"><span>Inventory, in real time</span><span>Sales and credit, in one place</span><span>Built for business in Uganda</span></div>
      </section>
      <form className="card auth" onSubmit={submit}>
        <div><span className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Get started today'}</span>
          <h2>{mode === 'login' ? 'Sign in to StockFlow' : 'Create your workspace'}</h2>
          <p className="mute">{mode === 'login' ? 'Pick up where you left off.' : 'Start with 14 days free. No card needed.'}</p></div>
        {mode === 'register' && <label>Business name<input value={f.business} onChange={set('business')} required minLength={2} autoComplete="organization" /></label>}
        <label>Email<input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
        <label>Password <span className="label-hint">(8+ characters)</span><input type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {err && <p className="red" role="alert">{err}</p>}
        <button className="btn">{mode === 'login' ? 'Sign in' : 'Create workspace'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New to StockFlow? Create an account' : 'Already have an account? Sign in'}
        </button>
        <p className="auth-footnote">Secure access to your business workspace</p>
      </form>
    </div>
  );
}

function Stock({ notify }) {
  const [items, reload] = useLoad('/api/items'), [f, setF] = useState({ name: '', qty: '', cost: '', price: '', minQty: 5 });
  const [add, setAdd] = useState({}), [photo, setPhoto] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const create = async (e) => {
    e.preventDefault();
    try { await api('/api/items', { method: 'POST', body: { name: f.name, qty: +f.qty, cost: +f.cost, price: +f.price, minQty: +f.minQty, ...(photo && { photo }) } }); setF({ name: '', qty: '', cost: '', price: '', minQty: 5 }); setPhoto(null); reload(); }
    catch (x) { notify(x.message); }
  };
  const restock = async (id) => { try { await api(`/api/items/${id}/restock`, { method: 'POST', body: { qty: +add[id] } }); setAdd({ ...add, [id]: '' }); reload(); } catch (x) { notify(x.message); } };
  const changePhoto = async (item, image, error) => {
    if (error) { notify(error); return; }
    try { await api(`/api/items/${item.id}/photo`, { method: image ? 'PUT' : 'DELETE', ...(image && { body: image }) }); notify(image ? 'Product photo saved.' : 'Product photo removed.'); reload(); }
    catch (x) { notify(x.message); }
  };
  return (<>
    <form className="card product-form" onSubmit={create}>
      <div className="section-heading"><div><span className="eyebrow">Your catalogue</span><h2>Add a product</h2></div></div>
      <div className="row">
        <label>Item<input value={f.name} onChange={set('name')} required /></label>
        <label>Quantity<input type="number" min="0" inputMode="numeric" value={f.qty} onChange={set('qty')} required /></label>
        <label>Buying price (UGX)<input type="number" min="0" inputMode="numeric" value={f.cost} onChange={set('cost')} required /></label>
        <label>Selling price (UGX)<input type="number" min="0" inputMode="numeric" value={f.price} onChange={set('price')} required /></label>
        <label>Alert at<input type="number" min="0" inputMode="numeric" value={f.minQty} onChange={set('minQty')} /></label>
      </div>
      <div className="product-form-footer"><ImageUploader label="Choose product photo" value={photo} maxDimension={960} onChange={setPhoto} /><button className="btn">Add product</button></div>
    </form>
    <div className="card inventory-card"><div className="section-heading"><div><span className="eyebrow">Live inventory</span><h2>Your products</h2></div><span className="inventory-count">{items?.length || 0} items</span></div><div className="tw"><table><thead><tr><th>Item</th><th className="n">In stock</th><th className="n">Selling price</th><th>Product photo</th><th>Restock</th></tr></thead>
      <tbody>{(items || []).map((i) => (
        <tr key={i.id}><td>{i.name} {i.qty <= i.min_qty && <span className="tag">Low</span>}</td><td className="n">{i.qty}</td><td className="n">{fmt(i.price)}</td>
          <td><ProductPhoto item={i} onChange={changePhoto} /></td>
          <td><input className="small" type="number" min="1" aria-label={`Add stock to ${i.name}`} value={add[i.id] || ''} onChange={(e) => setAdd({ ...add, [i.id]: e.target.value })} />{' '}
            <button className="btn alt sm" disabled={!add[i.id]} onClick={() => restock(i.id)}>Add</button></td></tr>))}
        {items?.length === 0 && <tr><td colSpan="5" className="mute">No items yet. Add your first one above.</td></tr>}</tbody></table></div></div>
  </>);
}

function Sell({ notify }) {
  const [items, reload] = useLoad('/api/items'), [cart, setCart] = useState([]), [pick, setPick] = useState({ id: '', qty: 1 });
  const [cust, setCust] = useState({ name: '', phone: '' }), [paid, setPaid] = useState(''), [method, setMethod] = useState('cash'), [ref, setRef] = useState('');
  const total = cart.reduce((a, l) => a + l.qty * l.price, 0);
  const addLine = () => {
    const i = items?.find((x) => x.id === pick.id); if (!i || pick.qty < 1) return;
    setCart([...cart, { itemId: i.id, name: i.name, price: i.price, qty: +pick.qty }]);
  };
  const save = async () => {
    try {
      const body = { lines: cart.map(({ itemId, qty }) => ({ itemId, qty })), method, ...(ref && { ref }), ...(paid !== '' && { paid: +paid }), ...((cust.name || cust.phone) && { customer: { name: cust.name || 'Customer', phone: cust.phone || undefined } }) };
      const r = await api('/api/sales', { method: 'POST', body });
      notify(r.balance ? `Sale saved. ${fmt(r.balance)} on credit.` : 'Sale saved.');
      setCart([]); setPaid(''); setCust({ name: '', phone: '' }); setRef(''); reload();
    } catch (x) { notify(x.message); }
  };
  return (<div className="card">
    <div className="row">
      <label>Item<select value={pick.id} onChange={(e) => setPick({ ...pick, id: e.target.value })}><option value="">Choose item</option>{(items || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.qty} in stock)</option>)}</select></label>
      <label>Quantity<input type="number" min="1" value={pick.qty} onChange={(e) => setPick({ ...pick, qty: e.target.value })} /></label>
      <button className="btn alt" onClick={addLine}>Add to sale</button>
    </div>
    <div className="tw"><table><tbody>{cart.map((l, k) => <tr key={k}><td>{l.name}</td><td className="n">{l.qty} × {fmt(l.price)}</td><td className="n">{fmt(l.qty * l.price)}</td><td><button className="btn alt sm" onClick={() => setCart(cart.filter((_, j) => j !== k))}>Remove</button></td></tr>)}</tbody>
      <tfoot><tr><td colSpan="2">Total</td><td className="n">{fmt(total)}</td><td /></tr></tfoot></table></div>
    <div className="row">
      <label>Customer name<input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} /></label>
      <label>Phone (for reminders)<input inputMode="tel" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} /></label>
    </div>
    <div className="row">
      <label>Paid now (empty = in full, 0 = credit)<input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></label>
      <label>Paid by<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="mtn_momo">MTN MoMo</option><option value="airtel_money">Airtel Money</option></select></label>
      <label>Mobile Money ID<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
    </div>
    <button className="btn" disabled={!cart.length} onClick={save}>Save sale</button>
  </div>);
}

function Credit({ notify }) {
  const [owed, reload] = useLoad('/api/credit'), [amt, setAmt] = useState({}), [sms, setSms] = useState(''), [match, setMatch] = useState(null);
  const pay = async (id, amount, method = 'cash', ref) => { try { const r = await api('/api/payments', { method: 'POST', body: { customerId: id, amount: +amount, method, ...(ref && { ref }) } }); notify(`Recorded ${fmt(r.applied)}.`); setAmt({ ...amt, [id]: '' }); setMatch(null); reload(); } catch (x) { notify(x.message); } };
  const remind = async (id) => { try { await api(`/api/credit/${id}/remind`, { method: 'POST' }); notify('SMS reminder sent.'); } catch (x) { notify(x.message); } };
  const find = async () => { try { setMatch(await api('/api/payments/mobile-money/match', { method: 'POST', body: { sms } })); } catch (x) { notify(x.message); } };
  return (<>
    <div className="card"><h2>Who owes you</h2>
      {(owed || []).map((d) => (<div className="row line" key={d.id}>
        <div className="grow"><b>{d.name}</b><br /><span className="mute">{d.phone || 'no phone'}</span></div><div className="red">{fmt(d.owed)}</div>
        <input className="small" type="number" min="1" aria-label={`Payment from ${d.name}`} placeholder="Amount" value={amt[d.id] || ''} onChange={(e) => setAmt({ ...amt, [d.id]: e.target.value })} />
        <button className="btn sm" disabled={!amt[d.id]} onClick={() => pay(d.id, amt[d.id])}>Record cash</button>
        <button className="btn sm alt" disabled={!d.phone} onClick={() => remind(d.id)}>Send SMS reminder</button></div>))}
      {owed?.length === 0 && <p className="mute">Nobody owes you. Sell on credit by entering 0 as "Paid now".</p>}</div>
    <div className="card"><h2>Match a Mobile Money message</h2>
      <textarea value={sms} onChange={(e) => setSms(e.target.value)} placeholder="Paste the MoMo or Airtel SMS here" />
      <button className="btn" disabled={sms.length < 5} onClick={find}>Find match</button>
      {match && <div><p>Found <b>{fmt(match.parsed.amount)}</b> {match.parsed.ref && `· ID ${match.parsed.ref}`}</p>
        {match.candidates.map((d) => <div className="row line" key={d.id}><span className="grow">{d.name} owes {fmt(d.owed)}</span><button className="btn sm" onClick={() => pay(d.id, match.parsed.amount, match.parsed.method, match.parsed.ref)}>Apply payment</button></div>)}
        {!match.candidates.length && <p className="mute">No unpaid sales to match.</p>}</div>}</div>
  </>);
}

const todayInUganda = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date());
const daysBefore = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const reportPath = (range) => `/api/reports?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
const reportCsvCell = (value) => {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

function Reports({ notify }) {
  const [range, setRange] = useState(() => {
    const to = todayInUganda();
    return { from: daysBefore(to, 29), to };
  });
  const [applied, setApplied] = useState(range), [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [question, setQuestion] = useState(''), [assistant, setAssistant] = useState(null), [asking, setAsking] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setAssistant(null);
    api(reportPath(applied)).then((data) => { if (active) setReport(data); })
      .catch((x) => { if (active) setError(x.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied]);
  const askAssistant = async (e) => {
    e.preventDefault(); setAsking(true);
    try {
      setAssistant(await api('/api/assistant/suggestions', {
        method: 'POST', body: { from: applied.from, to: applied.to, question: question.trim() },
      }));
    } catch (x) { notify(x.message); }
    finally { setAsking(false); }
  };
  const exportCsv = () => {
    if (!report) return;
    const rows = [
      ['StockFlow business report', report.period.from, report.period.to],
      [],
      ['Summary', 'Value'],
      ['Sales count', report.sales.count],
      ['Sales total (UGX)', report.sales.total],
      ['Estimated gross profit (UGX)', report.sales.gross_profit],
      ['Payments collected (UGX)', report.collections.reduce((sum, item) => sum + Number(item.total), 0)],
      ['Customers with outstanding credit', report.receivables.customers],
      ['Outstanding credit (UGX)', report.receivables.total],
      ['Products tracked', report.inventory.products],
      ['Low-stock products', report.inventory.low_stock],
      ['Stock cost value (UGX)', report.inventory.cost_value],
      ['Stock retail value (UGX)', report.inventory.retail_value],
      [],
      ['Daily activity', 'Sales count', 'Sales (UGX)', 'Collections (UGX)'],
      ...report.daily.map((row) => [row.day, row.sales, row.sales_total, row.collected]),
      [],
      ['Collections by method', 'Payments', 'Amount (UGX)'],
      ...report.collections.map((row) => [row.method.replaceAll('_', ' '), row.count, row.total]),
      [],
      ['Top products', 'Quantity sold', 'Sales value (UGX)'],
      ...report.topProducts.map((row) => [row.name, row.quantity, row.revenue]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(reportCsvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `stockflow-report-${report.period.from}-to-${report.period.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const applyQuickRange = (days) => {
    const to = todayInUganda();
    const next = { from: daysBefore(to, days - 1), to };
    setRange(next); setApplied(next);
  };
  const collected = report?.collections.reduce((sum, row) => sum + Number(row.total), 0) || 0;
  return <div className="report-page">
    <section className="welcome-panel report-welcome"><div><span className="eyebrow">Business intelligence</span><h2>Reports that help you plan</h2><p>Track sales, collections, stock value and customer credit in UGX.</p></div>
      <div className="report-actions no-print"><button className="btn alt" disabled={!report} onClick={exportCsv}>Download CSV</button><button className="btn" disabled={!report} onClick={() => window.print()}>Print / Save PDF</button></div>
    </section>
    <form className="card report-filter no-print" onSubmit={(e) => { e.preventDefault(); setApplied(range); }}>
      <div className="quick-ranges"><button type="button" className="btn alt sm" onClick={() => applyQuickRange(7)}>Last 7 days</button><button type="button" className="btn alt sm" onClick={() => applyQuickRange(30)}>Last 30 days</button><button type="button" className="btn alt sm" onClick={() => applyQuickRange(90)}>Last 90 days</button></div>
      <label>From<input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} required /></label>
      <label>To<input type="date" value={range.to} min={range.from} max={todayInUganda()} onChange={(e) => setRange({ ...range, to: e.target.value })} required /></label>
      <button className="btn" disabled={loading}>Run report</button>
    </form>
    {error && <p className="card error-message" role="alert">{error}</p>}
    {loading && <p className="card mute" role="status">Loading business report…</p>}
    {report && !loading && <>
      <header className="report-print-header"><div><span className="eyebrow">StockFlow UG · Business report</span><h2>{report.period.from} to {report.period.to}</h2></div><span>All figures in UGX</span></header>
      <section className="report-metrics">
        <article className="report-metric"><span>Sales recorded</span><strong>{fmt(report.sales.total)}</strong><small>{report.sales.count} transaction{report.sales.count === 1 ? '' : 's'}</small></article>
        <article className="report-metric"><span>Payments collected</span><strong>{fmt(collected)}</strong><small>By payment date</small></article>
        <article className="report-metric"><span>Estimated gross profit</span><strong>{fmt(report.sales.gross_profit)}</strong><small>Before rent, wages and other costs</small></article>
        <article className="report-metric"><span>Customer credit outstanding</span><strong>{fmt(report.receivables.total)}</strong><small>{report.receivables.customers} customer{report.receivables.customers === 1 ? '' : 's'}</small></article>
      </section>
      <section className="report-metrics inventory-metrics">
        <article className="report-metric"><span>Products tracked</span><strong>{report.inventory.products}</strong></article>
        <article className="report-metric"><span>Low-stock products</span><strong>{report.inventory.low_stock}</strong></article>
        <article className="report-metric"><span>Stock at cost value</span><strong>{fmt(report.inventory.cost_value)}</strong></article>
        <article className="report-metric"><span>Stock at retail value</span><strong>{fmt(report.inventory.retail_value)}</strong></article>
      </section>
      <div className="report-table-grid">
        <section className="card report-section"><div className="section-heading"><div><span className="eyebrow">Day by day</span><h2>Sales and collections</h2></div></div>
          <div className="tw"><table><thead><tr><th>Date</th><th className="n">Sales</th><th className="n">Sales total</th><th className="n">Collected</th></tr></thead>
            <tbody>{report.daily.map((row) => <tr key={row.day}><td>{row.day}</td><td className="n">{row.sales}</td><td className="n">{fmt(row.sales_total)}</td><td className="n">{fmt(row.collected)}</td></tr>)}</tbody></table></div>
        </section>
        <section className="card report-section"><div className="section-heading"><div><span className="eyebrow">Best movers</span><h2>Top products sold</h2></div></div>
          <div className="tw"><table><thead><tr><th>Product</th><th className="n">Qty</th><th className="n">Sales value</th></tr></thead>
            <tbody>{report.topProducts.map((row) => <tr key={row.name}><td>{row.name}</td><td className="n">{row.quantity}</td><td className="n">{fmt(row.revenue)}</td></tr>)}
              {!report.topProducts.length && <tr><td colSpan="3" className="mute">No sales in this period.</td></tr>}</tbody></table></div>
        </section>
      </div>
      <section className="card report-section collection-section"><div className="section-heading"><div><span className="eyebrow">Payment mix</span><h2>Collections by method</h2></div></div>
        <div className="collection-list">{report.collections.map((row) => <div className="collection-row" key={row.method}><span>{row.method.replaceAll('_', ' ')}</span><span>{row.count} payment{row.count === 1 ? '' : 's'}</span><strong>{fmt(row.total)}</strong></div>)}
          {!report.collections.length && <p className="mute">No payments recorded in this period.</p>}</div>
      </section>
      <section className="card assistant-panel no-print">
        <div className="section-heading"><div><span className="eyebrow">StockFlow business assistant</span><h2>Ask for practical suggestions</h2></div><span className={`ai-indicator ${assistant?.ai?.configured ? 'ai-ready' : ''}`}>{assistant?.ai?.configured ? 'AI connected' : 'Built-in advice available'}</span></div>
        <p className="settings-description">Suggestions use sales, stock and credit totals only. If AI is configured, these totals and your question are sent to your configured AI provider. Do not include customer or other personal details.</p>
        <form className="assistant-form" onSubmit={askAssistant}><label htmlFor="assistant-question">What would you like help with?<input id="assistant-question" maxLength="500" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: How can I manage low stock with limited cash?" /></label><button className="btn" disabled={asking}>{asking ? 'Thinking…' : 'Get suggestions'}</button></form>
        {assistant?.ai?.warning && <p className="assistant-warning" role="status">{assistant.ai.warning} Showing built-in suggestions below.</p>}
        {assistant && <div className="suggestion-grid">{assistant.suggestions.map((item) => <article className="suggestion-card" key={item.title}><span className="suggestion-category">{item.category}</span><h3>{item.title}</h3><p>{item.detail}</p></article>)}
          {assistant.ai.text && <article className="suggestion-card ai-suggestion"><span className="suggestion-category">AI suggestion</span><p className="ai-response">{assistant.ai.text}</p></article>}
          {!assistant.suggestions.length && !assistant.ai.text && <p className="mute">Add sales and stock records to get useful suggestions.</p>}</div>}
      </section>
      <p className="report-disclaimer">Reports use recorded transactions. Estimated gross profit excludes operating expenses, and stock values use current inventory quantities.</p>
    </>}
  </div>;
}

function Overview({ businessName, status, onNavigate }) {
  const [summary, setSummary] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([api('/api/items'), api('/api/credit')])
      .then(([items, owed]) => {
        if (active) setSummary({
          itemCount: items.length,
          lowStock: items.filter((item) => item.qty <= item.min_qty).length,
          receivables: owed.reduce((total, customer) => total + Number(customer.owed), 0),
        });
      })
      .catch((x) => { if (active) setError(x.message); });
    return () => { active = false; };
  }, []);
  const currentPlan = status?.plan && status.plans?.[status.plan]?.name;
  return (<>
    <section className="welcome-panel">
      <div>
        <span className="eyebrow">Your business workspace</span>
        <h2>{businessName}</h2>
        <p>Good to have you here. Keep an eye on stock, serve customers and stay on top of the day.</p>
      </div>
      <div className="workspace-status">
        <span className={`status-pill ${status?.active === true ? 'is-active' : status?.active === false ? 'is-expired' : ''}`}><span className="status-dot" />{status?.active === true ? 'Workspace active' : status?.active === false ? 'Renewal needed' : 'Checking status'}</span>
        {currentPlan && <span className="plan-label">{currentPlan} plan</span>}
      </div>
    </section>
    <div className="section-heading"><div><span className="eyebrow">A quick overview</span><h2>Today at a glance</h2></div></div>
    {error && <p className="card error-message" role="alert">{error}</p>}
    <section className="metric-grid" aria-label="Business overview">
      <article className="metric-card"><span className="metric-icon inventory-icon">01</span><span className="metric-label">Products tracked</span><strong>{summary ? summary.itemCount : '—'}</strong><span className="metric-note">Items in your inventory</span></article>
      <article className="metric-card"><span className="metric-icon attention-icon">02</span><span className="metric-label">Need restocking</span><strong>{summary ? summary.lowStock : '—'}</strong><span className="metric-note">At or below their alert level</span></article>
      <article className="metric-card"><span className="metric-icon revenue-icon">03</span><span className="metric-label">Customer balances</span><strong>{summary ? fmt(summary.receivables) : '—'}</strong><span className="metric-note">Outstanding credit to follow up</span></article>
    </section>
    <section className="section-heading action-heading"><div><span className="eyebrow">Keep things moving</span><h2>Quick actions</h2></div></section>
    <section className="action-grid">
      <button className="action-card" onClick={() => onNavigate('Sell')}><span className="action-icon sell-icon">↗</span><span><strong>Record a sale</strong><small>Serve a customer and update stock</small></span><span className="action-arrow">→</span></button>
      <button className="action-card" onClick={() => onNavigate('Stock')}><span className="action-icon stock-icon">＋</span><span><strong>Manage inventory</strong><small>Add products or restock items</small></span><span className="action-arrow">→</span></button>
      <button className="action-card" onClick={() => onNavigate('Credit')}><span className="action-icon credit-icon">◷</span><span><strong>Follow up on credit</strong><small>Review balances and record payments</small></span><span className="action-arrow">→</span></button>
    </section>
  </>);
}

function Billing({ notify }) {
  const [s] = useLoad('/api/billing/status');
  const buy = async (plan) => { try { window.location.href = (await api('/api/billing/checkout', { method: 'POST', body: { plan } })).link; } catch (x) { notify(x.message); } };
  if (!s || !s.plans) return <div className="card">Loading…</div>;
  const d = (x) => x && new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (<>
    <section className="welcome-panel billing-welcome"><div><span className="eyebrow">Plans &amp; billing</span><h2>Choose the right plan for your business</h2>
      <p>{s.active ? 'Your workspace is active. Manage your subscription below.' : 'Your subscription has expired. You can view records, but need to renew to record new activity.'}</p></div>
      <span className={`status-pill ${s.active ? 'is-active' : 'is-expired'}`}><span className="status-dot" />{s.active ? 'Active' : 'Renewal needed'}</span>
    </section>
    <section className="billing-detail card"><div className="section-heading"><div><span className="eyebrow">Your subscription</span><h2>Plan details</h2></div>{s.plan && <span className="current-plan">{s.plans[s.plan]?.name || s.plan} plan</span>}</div>
      <div className="billing-dates">{s.paid_until && <p><span>Paid through</span><strong>{d(s.paid_until)}</strong></p>}{s.trial_ends_at && <p><span>Free trial ends</span><strong>{d(s.trial_ends_at)}</strong></p>}</div>
    </section>
    <section className="section-heading plans-heading"><div><span className="eyebrow">Simple, transparent pricing</span><h2>Plans for your next stage</h2></div><p>30-day subscriptions · Prices in UGX</p></section>
    <section className="plan-grid">{Object.entries(s.plans).map(([k, p]) => {
      const isCurrent = s.plan === k;
      return <article key={k} className={`plan-card ${k === 'growth' ? 'featured-plan' : ''}`}>
        {k === 'growth' && <span className="plan-ribbon">Growth</span>}
        <span className="plan-name">{p.name}</span><p className="plan-description">{k === 'growth' ? 'For businesses ready to grow.' : 'A confident start for your business.'}</p>
        <p className="plan-price">{fmt(p.price)}<span> / 30 days</span></p>
        <div className="plan-rule" />
        <p className="plan-includes"><span className="check-mark">✓</span>Full access to your StockFlow workspace</p>
        <button className={k === 'growth' ? 'btn' : 'btn alt'} onClick={() => buy(k)}>{isCurrent ? 'Renew this plan' : `Choose ${p.name}`}</button>
        {isCurrent && <span className="current-plan-note">Your current plan</span>}
      </article>;
    })}</section>
    <p className="billing-footnote">Secure checkout with MTN MoMo, Airtel Money or card.</p>
  </>);
}

function Settings({ status, notify, logoUrl, logoError, refreshWorkspace, onNavigate }) {
  const [profile, setProfile] = useState({ name: '', district: '', phone: '' });
  const [logo, setLogo] = useState(null), [saving, setSaving] = useState(false);
  useEffect(() => {
    if (status?.name) setProfile({ name: status.name, district: status.district || '', phone: status.business_phone || '' });
  }, [status?.name, status?.district, status?.business_phone]);
  const set = (key) => (e) => setProfile({ ...profile, [key]: e.target.value });
  const saveProfile = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api('/api/business/profile', { method: 'PATCH', body: profile });
      await refreshWorkspace();
      notify('Business profile saved.');
    } catch (x) { notify(x.message); }
    finally { setSaving(false); }
  };
  const saveLogo = async () => {
    setSaving(true);
    try {
      await api('/api/business/logo', { method: 'PUT', body: logo });
      await refreshWorkspace(true);
      notify('Business logo saved.');
    } catch (x) { notify(x.message); }
    finally { setSaving(false); }
  };
  const removeLogo = async () => {
    setSaving(true);
    try {
      await api('/api/business/logo', { method: 'DELETE' });
      setLogo(null);
      await refreshWorkspace(true);
      notify('Business logo removed.');
    } catch (x) { notify(x.message); }
    finally { setSaving(false); }
  };
  return <>
    <section className="welcome-panel settings-welcome"><div><span className="eyebrow">Business settings</span><h2>Make this workspace yours</h2><p>Keep your business details up to date and add photos to help staff recognize products.</p></div></section>
    <form className="card settings-card" onSubmit={saveProfile}>
      <div className="section-heading"><div><span className="eyebrow">Business profile</span><h2>Local business details</h2></div></div>
      <div className="settings-grid">
        <label>Business name<input value={profile.name} onChange={set('name')} required minLength={2} maxLength={120} /></label>
        <label>District (optional)<input value={profile.district} onChange={set('district')} placeholder="For example, Wakiso" maxLength={100} /></label>
        <label>Business phone (optional)<input type="tel" inputMode="tel" autoComplete="tel" value={profile.phone} onChange={set('phone')} placeholder="0772 123456 or +256 772 123456" maxLength={24} /><span className="field-hint">Use a Ugandan mobile number. Your details stay with your business.</span></label>
      </div>
      <button className="btn" disabled={saving || !profile.name.trim()}>Save business details</button>
    </form>
    <section className="card settings-card">
      <div className="section-heading"><div><span className="eyebrow">Business identity</span><h2>Business logo</h2></div></div>
      <p className="settings-description">Your logo appears in the workspace menu. A clear photo or simple brand mark works best.</p>
      {logoError && <p className="red" role="alert">Logo preview unavailable: {logoError}</p>}
      <ImageUploader label="Choose business logo" value={logo} remoteUrl={logoUrl} maxDimension={600} onChange={setLogo} />
      <div className="settings-actions"><button className="btn" onClick={saveLogo} disabled={saving || !logo}>Save logo</button>
        {status?.has_logo && <button className="btn alt" disabled={saving} onClick={removeLogo}>Remove logo</button>}</div>
    </section>
    <section className="card settings-card">
      <div className="section-heading"><div><span className="eyebrow">On your product list</span><h2>Product photos</h2></div></div>
      <p className="settings-description">Add photos while creating products or update them from the Stock tab. Photos are resized before upload to save mobile data.</p>
      <button className="btn alt" onClick={() => onNavigate('Stock')}>Open inventory</button>
    </section>
    <p className="local-fit-note"><strong>Made for day-to-day trade:</strong> StockFlow keeps prices in UGX, supports cash and MTN or Airtel Mobile Money, and lets you record customer credit and use local phone numbers.</p>
  </>;
}

const TABS = { Home: Overview, Sell, Stock, Credit, Reports, Billing, Settings };
export default function App() {
  const [authed, setAuthed] = useState(!!getToken()), [tab, setTab] = useState('Home'), [msg, setMsg] = useState('');
  const notify = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3500); };
  if (!authed) return <div className="wrap auth-wrap"><Auth onDone={() => setAuthed(true)} /></div>;
  return <Workspace tab={tab} setTab={setTab} setAuthed={setAuthed} notify={notify} msg={msg} />;
}

function Workspace({ tab, setTab, setAuthed, notify, msg }) {
  const [status, reloadStatus] = useLoad('/api/billing/status');
  const [menuOpen, setMenuOpen] = useState(false), [logoRevision, setLogoRevision] = useState(0);
  const { image: logoImage, error: logoError } = useRemoteImage('/api/business/logo', !!status?.has_logo, logoRevision);
  const Tab = TABS[tab];
  const businessName = status?.name || 'Business workspace';
  const navigate = (next) => { setTab(next); setMenuOpen(false); };
  const refreshWorkspace = async (refreshLogo = false) => {
    await reloadStatus();
    if (refreshLogo) setLogoRevision((value) => value + 1);
  };
  return (<div className="wrap">
    <header className="app-header">
      <div className="brand-lockup">{logoImage ? <img className="brand-photo" src={logoImage} alt="" /> : <span className="brand-mark">S</span>}<span>StockFlow <span className="brand-region">UG</span></span></div>
      <div className="header-workspace"><span className="header-business">{businessName}</span><span className="header-caption">Business workspace</span></div>
      <div className="header-actions"><button className="menu-toggle" aria-expanded={menuOpen} aria-controls="workspace-menu" onClick={() => setMenuOpen(!menuOpen)}><span aria-hidden="true">{menuOpen ? '×' : '☰'}</span> Menu</button>
        <button className="sign-out" onClick={() => { setToken(null); setAuthed(false); }}>Sign out <span aria-hidden="true">↗</span></button></div>
    </header>
    <nav className={`app-nav ${menuOpen ? 'menu-open' : ''}`} id="workspace-menu" role="tablist" aria-label="Business workspace">
      {Object.keys(TABS).map((t) => <button key={t} role="tab" aria-selected={t === tab} onClick={() => navigate(t)}>{t === 'Home' && <span aria-hidden="true">⌂</span>}{t}</button>)}
    </nav>
    <main><Tab notify={notify} businessName={businessName} status={status} onNavigate={navigate} logoUrl={logoImage} logoError={logoError} refreshWorkspace={refreshWorkspace} /></main>
    {msg && <div id="toast" role="status">{msg}</div>}
  </div>);
}

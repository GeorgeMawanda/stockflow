/** Parse an MTN MoMo / Airtel Money confirmation SMS into structured data. */
export function normalizePhone(p) {
  if (!p) return null;
  const d = String(p).replace(/[^\d+]/g, '').replace(/^\+?256/, '0');
  return /^07\d{8}$/.test(d) ? d : null;
}

export function parseMomoSms(text) {
  const amt = text.match(/(?:UGX|USH)\s?([\d,]+)/i);
  if (!amt) return null;
  const phone = text.match(/(?:\+?256|0)7\d{8}/);
  const ref = text.match(/(?:TID|Txn ?ID|Transaction ID|Ref)[:.\s]*([A-Z0-9]{6,})/i);
  return {
    amount: Number(amt[1].replace(/,/g, '')),
    phone: normalizePhone(phone?.[0]),
    ref: ref?.[1] ?? null,
    method: /airtel/i.test(text) ? 'airtel_money' : 'mtn_momo',
  };
}

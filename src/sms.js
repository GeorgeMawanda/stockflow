/** Africa's Talking SMS. Username "sandbox" uses their test environment. */
export async function sendSms(to, message) {
  const sandbox = process.env.AT_USERNAME === 'sandbox';
  const res = await fetch(`https://api${sandbox ? '.sandbox' : ''}.africastalking.com/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: process.env.AT_USERNAME, to, message }),
  });
  if (!res.ok) throw new Error(`SMS gateway returned ${res.status}`);
  const r = (await res.json()).SMSMessageData?.Recipients?.[0];
  if (!r || ![100, 101, 102].includes(r.statusCode)) throw new Error(`SMS not accepted: ${r?.status ?? 'no recipient'}`);
}

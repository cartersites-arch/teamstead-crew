import { passwordSignIn, passwordReauth, setPassword } from '@/lib/passwords';
import { response, handleError, checkOrigin, fail } from '@/lib/chat-server';
export const dynamic = 'force-dynamic';
const windows = new Map<string, { at: number; count: number }>();
function rateLimit(request: Request) { const ip = request.headers.get('cf-connecting-ip') || 'local', now = Date.now(), prior = windows.get(ip); if (prior && now - prior.at < 60000) { if (++prior.count > 30) fail(429, 'Too many password attempts. Wait a minute and try again.'); } else { if (windows.size > 2000) windows.clear(); windows.set(ip, { at: now, count: 1 }); } }
export async function POST(request: Request) {
  try {
    checkOrigin(request); rateLimit(request); if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Use a supported password format.');
    const raw = await request.text(); if (raw.length > 10000) fail(413, 'This password request is too large.'); let data: Record<string, unknown>; try { data = JSON.parse(raw); } catch { fail(400, 'Please try again.'); } if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Please try again.');
    let result: { cookie?: string; [key: string]: unknown };
    if (data.action === 'sign_in') result = await passwordSignIn(data);
    else if (data.action === 'reauth') result = await passwordReauth(data);
    else if (data.action === 'set_password') result = await setPassword(data);
    else fail(400, 'Unknown password request.');
    const { cookie, ...body } = result, res = response(body); if (cookie) res.headers.set('Set-Cookie', cookie); return res;
  } catch (e) { return handleError(e); }
}

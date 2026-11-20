/**
 * PublishGuard 轻量级 Telegram 实时业务告警工具。
 * 用于新用户注册、书稿导入、队列入队与 Stripe 成单提醒；全程非阻塞静默降级，绝不影响业务主流程。
 */

import { getAllConfigs } from '@/modules/config/service';

function normalizeTelegramApiBase(raw: string | undefined): string {
  const clean = String(raw || 'https://api.telegram.org')
    .trim()
    .replace(/\/+$/, '');
  return clean || 'https://api.telegram.org';
}

/**
 * 异步发送 PublishGuard 业务告警到管理员 Telegram（优先读取环境变量，缺失时回退后台 config 表）。
 */
export async function notifyPublishGuardTelegram(
  text: string
): Promise<boolean> {
  const cleanText = String(text || '').trim();
  if (!cleanText) return false;

  try {
    let token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    let chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
    let apiBase = String(process.env.TELEGRAM_API_BASE || '').trim();

    if (!token || !chatId) {
      const configs = await getAllConfigs().catch(
        () => ({}) as Record<string, string>
      );
      token = token || String(configs.telegram_bot_token || '').trim();
      chatId = chatId || String(configs.telegram_chat_id || '').trim();
      apiBase = apiBase || String(configs.telegram_api_base || '').trim();
    }

    if (!token || !chatId) {
      return false;
    }

    const endpoint = `${normalizeTelegramApiBase(apiBase)}/bot${token}/sendMessage`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: cleanText,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn(`[telegram] alert failed with HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[telegram] alert skipped:', err?.message || err);
    return false;
  }
}

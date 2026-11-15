/**
 * PublishGuard 章节 HTML 白名单安全净化器（TypeScript 版，零外部依赖）。
 * 同时用于服务端章节入库接口与客户端 dangerouslySetInnerHTML 预览兜底，
 * 确保任意 <script>、<iframe>、on* 事件处理器、style 与 javascript:/data: 载荷均被物理清除。
 */

const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'blockquote',
  'em',
  'i',
  'strong',
  'b',
  'u',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'span',
  'div',
  'pre',
  'code',
]);

const VOID_TAGS = new Set(['br', 'hr']);

const DROP_WITH_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'meta',
  'link',
  'base',
  'noscript',
  'template',
  'title',
  'head',
]);

const SAFE_CLASS_TOKEN = /^[A-Za-z0-9_-]{1,40}$/;

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(val: string): string {
  return escapeHtmlText(val).replace(/"/g, '&quot;');
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function extractSafeHttpDomain(href: string | undefined): string {
  if (!href) return '';
  const cleaned = decodeBasicEntities(href).trim();
  if (!/^https?:\/\//i.test(cleaned)) return '';
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return cleaned.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function parseAttributes(attrSource: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe =
    /([a-zA-Z0-9:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(attrSource)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = val;
  }
  return attrs;
}

/**
 * 线性状态扫描净化 HTML 字符串，拒绝正则循环替换残留绕过。
 */
export function sanitizeChapterHtml(
  rawHtml: string | null | undefined
): string {
  if (!rawHtml) return '';
  const input = String(rawHtml).replace(/\0/g, '');
  const parts: string[] = [];
  const openTags: string[] = [];
  const dropStack: string[] = [];
  const anchorStack: string[] = [];

  let i = 0;
  const len = input.length;

  while (i < len) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      if (dropStack.length === 0) {
        parts.push(escapeHtmlText(decodeBasicEntities(input.slice(i))));
      }
      break;
    }

    if (lt > i && dropStack.length === 0) {
      parts.push(escapeHtmlText(decodeBasicEntities(input.slice(i, lt))));
    }

    // 注释或声明直接跳过（如 <!-- ... -->、<!DOCTYPE ...>、<?...?>）
    if (input.startsWith('<!--', lt)) {
      const endComment = input.indexOf('-->', lt + 4);
      i = endComment === -1 ? len : endComment + 3;
      continue;
    }
    if (input[lt + 1] === '!' || input[lt + 1] === '?') {
      const endDecl = input.indexOf('>', lt + 2);
      i = endDecl === -1 ? len : endDecl + 1;
      continue;
    }

    // 引号感知查找标签闭合 `>`
    let quote: string | null = null;
    let gt = -1;
    for (let j = lt + 1; j < len; j++) {
      const ch = input[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else {
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') {
          gt = j;
          break;
        }
      }
    }

    if (gt === -1) {
      // 未闭合尖括号当作纯文本安全转义（若处于 dropStack 内则直接丢弃）
      if (dropStack.length === 0) {
        parts.push('&lt;');
        i = lt + 1;
        continue;
      }
      break;
    }

    const rawTag = input.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (!rawTag) continue;

    const isClosing = rawTag.startsWith('/');
    const tagBody = isClosing ? rawTag.slice(1).trim() : rawTag;
    const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)(?:\s+([\s\S]*))?$/.exec(tagBody);
    if (!tagMatch) {
      if (dropStack.length === 0) {
        parts.push(escapeHtmlText(`<${rawTag}>`));
      }
      continue;
    }

    const tagName = tagMatch[1].toLowerCase();
    const attrPart = (tagMatch[2] || '').replace(/\/$/, '').trim();
    const isSelfClosing = !isClosing && rawTag.endsWith('/');

    if (isClosing) {
      if (dropStack.length > 0) {
        const idx = dropStack.lastIndexOf(tagName);
        if (idx !== -1) {
          dropStack.length = idx;
        }
        continue;
      }
      if (tagName === 'a') {
        const domain = anchorStack.pop();
        if (domain) {
          parts.push(
            ` (<span class="url-text">${escapeHtmlText(domain)}</span>)`
          );
        }
        continue;
      }
      if (!ALLOWED_TAGS.has(tagName) || VOID_TAGS.has(tagName)) continue;
      const openIdx = openTags.lastIndexOf(tagName);
      if (openIdx !== -1) {
        while (openTags.length > openIdx) {
          const popped = openTags.pop()!;
          parts.push(`</${popped}>`);
        }
      }
      continue;
    }

    if (DROP_WITH_CONTENT_TAGS.has(tagName)) {
      if (!isSelfClosing) {
        dropStack.push(tagName);
      }
      continue;
    }

    if (dropStack.length > 0) continue;

    if (tagName === 'a') {
      const attrs = parseAttributes(attrPart);
      anchorStack.push(extractSafeHttpDomain(attrs.href));
      continue;
    }

    if (!ALLOWED_TAGS.has(tagName)) continue;

    if (VOID_TAGS.has(tagName)) {
      parts.push(`<${tagName} />`);
      continue;
    }

    const attrs = parseAttributes(attrPart);
    const safeClassTokens = (attrs.class || '')
      .split(/\s+/)
      .filter((tok) => SAFE_CLASS_TOKEN.test(tok));
    const classAttr =
      safeClassTokens.length > 0
        ? ` class="${escapeAttr(safeClassTokens.join(' '))}"`
        : '';

    parts.push(`<${tagName}${classAttr}>`);
    if (!isSelfClosing) {
      openTags.push(tagName);
    } else {
      parts.push(`</${tagName}>`);
    }
  }

  while (openTags.length > 0) {
    parts.push(`</${openTags.pop()!}>`);
  }

  return parts.join('').trim();
}

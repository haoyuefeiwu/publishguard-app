/**
 * Python 出版引擎与 26 项合规 Guard 服务调用桥。
 * 通过标准输入输出 JSON 与 `worker/` 脚本通信，避免在 Node.js 中重复维护两套校验规则。
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { getAllConfigs } from '@/modules/config/service';

function getPythonBin(): string {
  return process.env.PYTHON_BIN || 'python3';
}

function getWorkerScript(scriptName: string): string {
  return resolve(/*turbopackIgnore: true*/ process.cwd(), 'worker', scriptName);
}

/**
 * 执行指定 worker Python 脚本并通过 stdin 传入 JSON payload。
 */
export async function runPythonJsonScript<T = any>(
  scriptName: string,
  args: string[],
  payload: Record<string, any>,
  timeoutMs = 60_000
): Promise<T> {
  const pythonBin = getPythonBin();
  const scriptPath = getWorkerScript(scriptName);

  return new Promise<T>((resolvePromise, reject) => {
    const proc = spawn(pythonBin, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(
        new Error(`Python script ${scriptName} timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    function sanitizePythonFailure(
      scriptName: string,
      code: number | null,
      stderr: string
    ): string {
      const trimmed = stderr.trim();
      if (trimmed) {
        console.error(
          `[python-bridge] ${scriptName} exited (${code}):`,
          trimmed
        );
      }
      const lastLine =
        trimmed
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop() || '';
      if (
        lastLine &&
        !/traceback|file\s+["']|\/app\/|\/users\//i.test(trimmed) &&
        lastLine.length <= 160
      ) {
        return lastLine;
      }
      return `Audit/engine process (${scriptName}) failed to process the input. Please verify the file format and try again.`;
    }

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(sanitizePythonFailure(scriptName, code, stderr)));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout) as T);
      } catch (parseErr: any) {
        console.error(
          `[python-bridge] Invalid JSON from ${scriptName}:`,
          parseErr?.message,
          stdout.slice(0, 300)
        );
        reject(
          new Error(
            `PublishGuard engine (${scriptName}) returned an invalid response. Please try again.`
          )
        );
      }
    });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

export interface GuardAuditFinding {
  code: string;
  severity: string;
  rule_ref: string;
  rule_tier?: 'platform_spec' | 'risk_advisory';
  message: string;
  matched_text: string;
  suggestion: string;
}

export interface GuardAuditResponse {
  passed: boolean;
  score: number;
  mode: string;
  word_count: number;
  errors: GuardAuditFinding[];
  warnings: GuardAuditFinding[];
  collisions: {
    checked: boolean;
    sources: string[];
    exact_matches: Array<{ title: string; author: string; source: string }>;
    similar_titles: Array<{ title: string; author: string; source: string }>;
  };
  suggestions: Array<{ original: string; replacement: string }>;
  checks_not_run?: Array<{ code: string; title: string; reason: string }>;
}

/**
 * 调用 `kdp_guard_service.py` 运行 26 项上架前物理合规体检与全网撞车查重。
 */
export async function executeKdpGuardAudit(params: {
  title?: string;
  subtitle?: string;
  description?: string;
  author_name?: string;
  primary_category?: string;
  manuscript_text?: string;
  epub_base64?: string;
  companion_domain?: string;
  other_pen_domains?: string[];
  existing_pen_titles?: string[];
  mode?: 'ebook' | 'paperback' | 'dual';
  lang?: 'en' | 'zh';
  check_live_collisions?: boolean;
  enforce_min_words?: boolean;
}): Promise<GuardAuditResponse> {
  return runPythonJsonScript<GuardAuditResponse>(
    'kdp_guard_service.py',
    ['--stdin'],
    params,
    25_000
  );
}

/**
 * 获取管理后台解密后的 OpenRouter 与模型路由配置，供大纲/试读/洗稿调用。
 */
async function getResolvedLlmRouting() {
  const configs = await getAllConfigs();
  return {
    api_key: configs.openrouter_api_key || process.env.OPENROUTER_API_KEY || '',
    base_url:
      configs.openrouter_base_url ||
      process.env.OPENROUTER_BASE_URL ||
      'https://openrouter.ai/api/v1',
    outline_model:
      configs.kdp_outline_model ||
      process.env.KDP_OUTLINE_MODEL ||
      'google/gemini-2.5-flash',
    writer_model:
      configs.kdp_writer_model ||
      process.env.KDP_WRITER_MODEL ||
      'anthropic/claude-sonnet-4',
    sanitizer_model:
      configs.kdp_sanitizer_model ||
      process.env.KDP_SANITIZER_MODEL ||
      'google/gemini-2.5-flash',
  };
}

export async function generateBookOutlineViaPython(params: {
  topic: string;
  audience: string;
  pen_name: string;
  genre: string;
  companion_product?: string;
  language?: string;
}) {
  const llm = await getResolvedLlmRouting();
  return runPythonJsonScript<{
    title_options: string[];
    recommended_subtitle: string;
    primary_category: string;
    subcategory_hint: string;
    back_blurb: string;
    keywords: string[];
    chapters: Array<{
      chapter_index: number;
      section_type: string;
      title: string;
      slug: string;
      summary: string;
    }>;
  }>(
    'book_writer.py',
    ['--action', 'outline'],
    {
      ...params,
      api_key: llm.api_key,
      base_url: llm.base_url,
      model: llm.outline_model,
    },
    90_000
  );
}

export async function generateChapterPreviewViaPython(params: {
  book_title: string;
  subtitle: string;
  chapter_title: string;
  chapter_summary: string;
  section_type: string;
  prev_summaries?: string[];
  companion_product?: string;
  target_words?: number;
}) {
  const llm = await getResolvedLlmRouting();
  return runPythonJsonScript<{ content_html: string }>(
    'book_writer.py',
    ['--action', 'chapter'],
    {
      ...params,
      api_key: llm.api_key,
      base_url: llm.base_url,
      model: llm.writer_model,
    },
    120_000
  );
}

export async function autoSanitizeViaPython(params: {
  raw_text: string;
  findings: GuardAuditResponse['errors'];
}) {
  const llm = await getResolvedLlmRouting();
  return runPythonJsonScript<{ sanitized_text: string }>(
    'book_writer.py',
    ['--action', 'sanitize'],
    {
      ...params,
      api_key: llm.api_key,
      base_url: llm.base_url,
      model: llm.sanitizer_model,
    },
    60_000
  );
}

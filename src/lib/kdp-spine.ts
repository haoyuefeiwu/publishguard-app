/**
 * Amazon KDP 平装本（Paperback）官方书脊、全覆盖环绕封面、出血与装订边距纯计算引擎。
 * 严格零外部依赖，可在浏览器、Next.js 服务端与 Node 测试环境直接运行。
 */

export type KdpPaperTypeId =
  | 'white'
  | 'cream'
  | 'standard_color'
  | 'premium_color';

export interface KdpPaperTypeSpec {
  id: KdpPaperTypeId;
  /** 每页纸张厚度（英寸） */
  thicknessIn: number;
  minPages: number;
  maxPages: number;
  studioPaper: 'white' | 'cream';
  labelEn: string;
  labelZh: string;
  descEn: string;
  descZh: string;
}

export interface KdpTrimSizeSpec {
  id: string;
  widthIn: number;
  heightIn: number;
  labelEn: string;
  labelZh: string;
  studioSupported: boolean;
}

export interface KdpSpineInput {
  trimSizeId: string;
  paperType: KdpPaperTypeId;
  pageCount: number;
  hasBleed: boolean;
}

export interface KdpPaperbackSpecs {
  trimSize: KdpTrimSizeSpec;
  paperSpec: KdpPaperTypeSpec;
  requestedPageCount: number;
  pageCount: number;
  pageCountClamped: boolean;
  hasBleed: boolean;
  bleedIn: number;
  thicknessPerPageIn: number;
  spineWidthIn: number;
  spineWidthMm: number;
  spineWidthPx: number;
  fullCoverWidthIn: number;
  fullCoverHeightIn: number;
  fullCoverWidthMm: number;
  fullCoverHeightMm: number;
  fullCoverWidthPx: number;
  fullCoverHeightPx: number;
  /** KDP 官方要求总页数 >= 79 页才允许在书脊印刷文字（需保证 >= 0.0625" 文字安全区） */
  spineTextAllowed: boolean;
  spineTextMinPages: number;
  spineTextSafeWidthIn: number;
  spineTextSafeWidthMm: number;
  gutterMarginIn: number;
  gutterMarginMm: number;
  outsideMarginIn: number;
  outsideMarginMm: number;
  interiorWidthIn: number;
  interiorHeightIn: number;
  interiorWidthMm: number;
  interiorHeightMm: number;
  interiorWidthPx: number;
  interiorHeightPx: number;
  barcodeWidthIn: number;
  barcodeHeightIn: number;
  barcodeMarginBottomIn: number;
  barcodeMarginRightIn: number;
  studioImportParams: {
    trim: '5.5x8.5' | '6x9' | '8.5x11';
    paper: 'white' | 'cream';
  };
}

const INCH_TO_MM = 25.4;
const PRINT_DPI = 300;
const COVER_BLEED_IN = 0.125;
const SPINE_TEXT_MIN_PAGES = 79;
const SPINE_TEXT_EDGE_BUFFER_IN = 0.0625;

/** KDP 官方纸张厚度系数表（2026 标准） */
export const KDP_PAPER_TYPES: Record<KdpPaperTypeId, KdpPaperTypeSpec> = {
  cream: {
    id: 'cream',
    thicknessIn: 0.0025,
    minPages: 24,
    maxPages: 776,
    studioPaper: 'cream',
    labelEn: 'Cream Paper (B&W)',
    labelZh: '米黄纸（黑白印刷）',
    descEn: '0.0025" / page · Ideal for non-fiction & fiction',
    descZh: '0.0025" / 页 · 非虚构专著与小说最常用',
  },
  white: {
    id: 'white',
    thicknessIn: 0.002252,
    minPages: 24,
    maxPages: 828,
    studioPaper: 'white',
    labelEn: 'White Paper (B&W)',
    labelZh: '纯白纸（黑白印刷）',
    descEn: '0.002252" / page · Crisp reference & guides',
    descZh: '0.002252" / 页 · 教材、指南与工具书常用',
  },
  standard_color: {
    id: 'standard_color',
    thicknessIn: 0.002252,
    minPages: 72,
    maxPages: 600,
    studioPaper: 'white',
    labelEn: 'Standard Color (White)',
    labelZh: '标准彩印（白纸）',
    descEn: '0.002252" / page · Min 72 pages for color',
    descZh: '0.002252" / 页 · 最低 72 页起印',
  },
  premium_color: {
    id: 'premium_color',
    thicknessIn: 0.002347,
    minPages: 24,
    maxPages: 828,
    studioPaper: 'white',
    labelEn: 'Premium Color (White)',
    labelZh: '高级彩印（加厚白纸）',
    descEn: '0.002347" / page · Heavy ink photography & art',
    descZh: '0.002347" / 页 · 高饱和画册与童书绘本',
  },
};

/** KDP 官方常用平装裁切规格列表 */
export const KDP_TRIM_SIZES: readonly KdpTrimSizeSpec[] = [
  {
    id: '5x8',
    widthIn: 5.0,
    heightIn: 8.0,
    labelEn: '5" × 8" (Compact Novel)',
    labelZh: '5" × 8"（便携平装）',
    studioSupported: false,
  },
  {
    id: '5.06x7.81',
    widthIn: 5.06,
    heightIn: 7.81,
    labelEn: '5.06" × 7.81" (UK B-Format)',
    labelZh: '5.06" × 7.81"（英式 B 开本）',
    studioSupported: false,
  },
  {
    id: '5.25x8',
    widthIn: 5.25,
    heightIn: 8.0,
    labelEn: '5.25" × 8" (Fiction)',
    labelZh: '5.25" × 8"（常规小说开本）',
    studioSupported: false,
  },
  {
    id: '5.5x8.5',
    widthIn: 5.5,
    heightIn: 8.5,
    labelEn: '5.5" × 8.5" (Digest Trade)',
    labelZh: '5.5" × 8.5"（标准文摘开本）',
    studioSupported: true,
  },
  {
    id: '6x9',
    widthIn: 6.0,
    heightIn: 9.0,
    labelEn: '6" × 9" (Most Popular KDP Trade)',
    labelZh: '6" × 9"（KDP 最热门标准开本）',
    studioSupported: true,
  },
  {
    id: '6.14x9.21',
    widthIn: 6.14,
    heightIn: 9.21,
    labelEn: '6.14" × 9.21" (Royal)',
    labelZh: '6.14" × 9.21"（皇家大开本）',
    studioSupported: false,
  },
  {
    id: '6.69x9.61',
    widthIn: 6.69,
    heightIn: 9.61,
    labelEn: '6.69" × 9.61" (Crown Quarto)',
    labelZh: '6.69" × 9.61"（学术四开本）',
    studioSupported: false,
  },
  {
    id: '7x10',
    widthIn: 7.0,
    heightIn: 10.0,
    labelEn: '7" × 10" (Textbook / Manual)',
    labelZh: '7" × 10"（教程手册开本）',
    studioSupported: false,
  },
  {
    id: '7.44x9.69',
    widthIn: 7.44,
    heightIn: 9.69,
    labelEn: '7.44" × 9.69" (Technical)',
    labelZh: '7.44" × 9.69"（技术专著开本）',
    studioSupported: false,
  },
  {
    id: '7.5x9.25',
    widthIn: 7.5,
    heightIn: 9.25,
    labelEn: '7.5" × 9.25" (Cookbook / Illustrated)',
    labelZh: '7.5" × 9.25"（食谱插画本）',
    studioSupported: false,
  },
  {
    id: '8x10',
    widthIn: 8.0,
    heightIn: 10.0,
    labelEn: '8" × 10" (Large Guide)',
    labelZh: '8" × 10"（大开本指南）',
    studioSupported: false,
  },
  {
    id: '8.25x6',
    widthIn: 8.25,
    heightIn: 6.0,
    labelEn: '8.25" × 6" (Landscape Picture Book)',
    labelZh: '8.25" × 6"（横版绘本）',
    studioSupported: false,
  },
  {
    id: '8.25x8.25',
    widthIn: 8.25,
    heightIn: 8.25,
    labelEn: '8.25" × 8.25" (Square Picture Book)',
    labelZh: '8.25" × 8.25"（方形绘本）',
    studioSupported: false,
  },
  {
    id: '8.5x8.5',
    widthIn: 8.5,
    heightIn: 8.5,
    labelEn: '8.5" × 8.5" (Large Square)',
    labelZh: '8.5" × 8.5"（大方形绘本）',
    studioSupported: false,
  },
  {
    id: '8.5x11',
    widthIn: 8.5,
    heightIn: 11.0,
    labelEn: '8.5" × 11" (US Letter / Reference)',
    labelZh: '8.5" × 11"（美标 Letter / 大开本）',
    studioSupported: true,
  },
];

/** 按 KDP 官方页数分档返回最小装订内边距（Gutter / Inside Margin） */
export function getKdpGutterMarginIn(pageCount: number): number {
  if (pageCount <= 150) return 0.375;
  if (pageCount <= 300) return 0.5;
  if (pageCount <= 500) return 0.625;
  if (pageCount <= 700) return 0.75;
  return 0.875;
}

/** 将计算器所选尺寸与纸型映射到 PublishGuard Studio 支持的预设参数 */
export function mapSpecsToStudioImportParams(input: {
  trimSizeId: string;
  paperType: KdpPaperTypeId;
}): {
  trim: '5.5x8.5' | '6x9' | '8.5x11';
  paper: 'white' | 'cream';
} {
  const trim: '5.5x8.5' | '6x9' | '8.5x11' =
    input.trimSizeId === '5.5x8.5' ||
    input.trimSizeId === '6x9' ||
    input.trimSizeId === '8.5x11'
      ? input.trimSizeId
      : '6x9';
  const paperSpec = KDP_PAPER_TYPES[input.paperType] || KDP_PAPER_TYPES.cream;
  return { trim, paper: paperSpec.studioPaper };
}

/** 四舍五入保留固定小数位（避免浮点精度尾差影响 UI 展示） */
export function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** 计算完整的 KDP 平装全覆盖封面、书脊、内页与条码安全区参数 */
export function calculateKdpPaperbackSpecs(
  input: KdpSpineInput
): KdpPaperbackSpecs {
  const trimSize =
    KDP_TRIM_SIZES.find((t) => t.id === input.trimSizeId) ||
    KDP_TRIM_SIZES.find((t) => t.id === '6x9')!;
  const paperSpec = KDP_PAPER_TYPES[input.paperType] || KDP_PAPER_TYPES.cream;

  const parsedPages = Number.isFinite(input.pageCount)
    ? Math.trunc(input.pageCount)
    : 100;
  const pageCount = Math.min(
    paperSpec.maxPages,
    Math.max(paperSpec.minPages, parsedPages)
  );
  const pageCountClamped = pageCount !== parsedPages;

  const thicknessPerPageIn = paperSpec.thicknessIn;
  const spineWidthIn = roundTo(pageCount * thicknessPerPageIn, 4);
  const spineWidthMm = roundTo(spineWidthIn * INCH_TO_MM, 2);
  const spineWidthPx = Math.round(spineWidthIn * PRINT_DPI);

  const fullCoverWidthIn = roundTo(
    COVER_BLEED_IN +
      trimSize.widthIn +
      spineWidthIn +
      trimSize.widthIn +
      COVER_BLEED_IN,
    4
  );
  const fullCoverHeightIn = roundTo(
    COVER_BLEED_IN + trimSize.heightIn + COVER_BLEED_IN,
    4
  );
  const fullCoverWidthMm = roundTo(fullCoverWidthIn * INCH_TO_MM, 2);
  const fullCoverHeightMm = roundTo(fullCoverHeightIn * INCH_TO_MM, 2);
  const fullCoverWidthPx = Math.round(fullCoverWidthIn * PRINT_DPI);
  const fullCoverHeightPx = Math.round(fullCoverHeightIn * PRINT_DPI);

  const spineTextAllowed = pageCount >= SPINE_TEXT_MIN_PAGES;
  const spineTextSafeWidthIn = spineTextAllowed
    ? roundTo(Math.max(0, spineWidthIn - SPINE_TEXT_EDGE_BUFFER_IN * 2), 4)
    : 0;
  const spineTextSafeWidthMm = roundTo(spineTextSafeWidthIn * INCH_TO_MM, 2);

  const gutterMarginIn = getKdpGutterMarginIn(pageCount);
  const gutterMarginMm = roundTo(gutterMarginIn * INCH_TO_MM, 2);

  const hasBleed = Boolean(input.hasBleed);
  const outsideMarginIn = hasBleed ? 0.375 : 0.25;
  const outsideMarginMm = roundTo(outsideMarginIn * INCH_TO_MM, 2);

  // KDP 内页加出血规则：宽度仅单侧外边 +0.125"，高度上下各 +0.125" 共 +0.25"
  const interiorWidthIn = roundTo(trimSize.widthIn + (hasBleed ? 0.125 : 0), 4);
  const interiorHeightIn = roundTo(
    trimSize.heightIn + (hasBleed ? 0.25 : 0),
    4
  );
  const interiorWidthMm = roundTo(interiorWidthIn * INCH_TO_MM, 2);
  const interiorHeightMm = roundTo(interiorHeightIn * INCH_TO_MM, 2);
  const interiorWidthPx = Math.round(interiorWidthIn * PRINT_DPI);
  const interiorHeightPx = Math.round(interiorHeightIn * PRINT_DPI);

  return {
    trimSize,
    paperSpec,
    requestedPageCount: parsedPages,
    pageCount,
    pageCountClamped,
    hasBleed,
    bleedIn: COVER_BLEED_IN,
    thicknessPerPageIn,
    spineWidthIn,
    spineWidthMm,
    spineWidthPx,
    fullCoverWidthIn,
    fullCoverHeightIn,
    fullCoverWidthMm,
    fullCoverHeightMm,
    fullCoverWidthPx,
    fullCoverHeightPx,
    spineTextAllowed,
    spineTextMinPages: SPINE_TEXT_MIN_PAGES,
    spineTextSafeWidthIn,
    spineTextSafeWidthMm,
    gutterMarginIn,
    gutterMarginMm,
    outsideMarginIn,
    outsideMarginMm,
    interiorWidthIn,
    interiorHeightIn,
    interiorWidthMm,
    interiorHeightMm,
    interiorWidthPx,
    interiorHeightPx,
    barcodeWidthIn: 2.0,
    barcodeHeightIn: 1.2,
    barcodeMarginBottomIn: 0.25,
    barcodeMarginRightIn: 0.25,
    studioImportParams: mapSpecsToStudioImportParams({
      trimSizeId: trimSize.id,
      paperType: paperSpec.id,
    }),
  };
}

/** 生成与 KDP 实测尺度一致的环绕封面 SVG 参考模板（`includeHeader=false` 时严格匹配印刷全幅像素比） */
export function buildKdpCoverTemplateSvg(
  specs: KdpPaperbackSpecs,
  options: { includeHeader?: boolean } = {}
): string {
  const includeHeader = options.includeHeader !== false;
  const scale = 100; // 1 英寸 = 100 SVG 坐标单位
  const W = roundTo(specs.fullCoverWidthIn * scale, 2);
  const H = roundTo(specs.fullCoverHeightIn * scale, 2);
  const bleed = COVER_BLEED_IN * scale;
  const trimW = specs.trimSize.widthIn * scale;
  const trimH = specs.trimSize.heightIn * scale;
  const spineW = roundTo(specs.spineWidthIn * scale, 2);

  const spineX = roundTo(bleed + trimW, 2);
  const frontX = roundTo(spineX + spineW, 2);
  const safeInset = 0.125 * scale;

  const barcodeW = specs.barcodeWidthIn * scale;
  const barcodeH = specs.barcodeHeightIn * scale;
  const barcodeX = roundTo(
    spineX - specs.barcodeMarginRightIn * scale - barcodeW,
    2
  );
  const barcodeY = roundTo(
    bleed + trimH - specs.barcodeMarginBottomIn * scale - barcodeH,
    2
  );

  const headerH = includeHeader ? 56 : 0;
  const totalH = roundTo(H + headerH, 2);
  const outHeightPx = includeHeader
    ? Math.round(specs.fullCoverWidthPx * (totalH / W))
    : specs.fullCoverHeightPx;
  const spineLabel = specs.spineTextAllowed
    ? `SPINE ${specs.spineWidthIn.toFixed(4)}"`
    : `${specs.spineWidthIn.toFixed(3)}" (<79pp NO TEXT)`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" width="${specs.fullCoverWidthPx}" height="${outHeightPx}">`,
    `  <rect x="0" y="0" width="${W}" height="${totalH}" fill="#ffffff"/>`,
    includeHeader
      ? `  <rect x="0" y="0" width="${W}" height="${headerH}" fill="#0f172a"/>`
      : '',
    includeHeader
      ? `  <text x="20" y="25" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" font-weight="700" fill="#f8fafc">PublishGuard KDP Cover Guide · ${specs.fullCoverWidthIn.toFixed(4)}" × ${specs.fullCoverHeightIn.toFixed(4)}" (${specs.fullCoverWidthPx} × ${specs.fullCoverHeightPx} px @ 300 DPI)</text>`
      : '',
    includeHeader
      ? `  <text x="20" y="45" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" fill="#cbd5e1">Trim ${specs.trimSize.widthIn}"×${specs.trimSize.heightIn}" · ${specs.pageCount} pp · ${specs.paperSpec.labelEn} · Spine ${specs.spineWidthIn.toFixed(4)}" (${specs.spineWidthMm} mm)</text>`
      : '',
    `  <g transform="translate(0, ${headerH})">`,
    // 全出血底色区
    `    <rect x="0" y="0" width="${W}" height="${H}" fill="#fee2e2"/>`,
    // 成品裁切区内白底
    `    <rect x="${bleed}" y="${bleed}" width="${roundTo(W - bleed * 2, 2)}" height="${trimH}" fill="#f8fafc" stroke="#0f172a" stroke-width="2" stroke-dasharray="8 6"/>`,
    // 封底安全区
    `    <rect x="${bleed + safeInset}" y="${bleed + safeInset}" width="${roundTo(trimW - safeInset * 2, 2)}" height="${roundTo(trimH - safeInset * 2, 2)}" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="5 4"/>`,
    // 封面安全区
    `    <rect x="${frontX + safeInset}" y="${bleed + safeInset}" width="${roundTo(trimW - safeInset * 2, 2)}" height="${roundTo(trimH - safeInset * 2, 2)}" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="5 4"/>`,
    // 书脊区
    `    <rect x="${spineX}" y="${bleed}" width="${spineW}" height="${trimH}" fill="${specs.spineTextAllowed ? '#e0f2fe' : '#fef3c7'}" stroke="#0284c7" stroke-width="1.5"/>`,
    // 书脊文字安全边界
    specs.spineTextAllowed && specs.spineTextSafeWidthIn > 0
      ? `    <rect x="${roundTo(spineX + SPINE_TEXT_EDGE_BUFFER_IN * scale, 2)}" y="${bleed + safeInset}" width="${roundTo(specs.spineTextSafeWidthIn * scale, 2)}" height="${roundTo(trimH - safeInset * 2, 2)}" fill="none" stroke="#0369a1" stroke-width="1" stroke-dasharray="3 3"/>`
      : '',
    // 背面与正面文字标识
    `    <text x="${roundTo(bleed + trimW / 2, 2)}" y="${roundTo(bleed + trimH * 0.42, 2)}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="700" fill="#1e293b">BACK COVER</text>`,
    `    <text x="${roundTo(bleed + trimW / 2, 2)}" y="${roundTo(bleed + trimH * 0.46, 2)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="14" fill="#64748b">${specs.trimSize.widthIn}" × ${specs.trimSize.heightIn}" Trim</text>`,
    `    <text x="${roundTo(frontX + trimW / 2, 2)}" y="${roundTo(bleed + trimH * 0.42, 2)}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="700" fill="#0f172a">FRONT COVER</text>`,
    `    <text x="${roundTo(frontX + trimW / 2, 2)}" y="${roundTo(bleed + trimH * 0.46, 2)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="14" fill="#64748b">${specs.trimSize.widthIn}" × ${specs.trimSize.heightIn}" Trim</text>`,
    // 书脊纵向标注
    `    <text x="${roundTo(spineX + spineW / 2, 2)}" y="${roundTo(bleed + trimH / 2, 2)}" transform="rotate(-90 ${roundTo(spineX + spineW / 2, 2)} ${roundTo(bleed + trimH / 2, 2)})" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="${specs.spineTextAllowed ? '#0369a1' : '#b45309'}">${spineLabel}</text>`,
    // 条码白底安全区
    `    <rect x="${barcodeX}" y="${barcodeY}" width="${barcodeW}" height="${barcodeH}" fill="#ffffff" stroke="#dc2626" stroke-width="1.5"/>`,
    `    <text x="${roundTo(barcodeX + barcodeW / 2, 2)}" y="${roundTo(barcodeY + barcodeH * 0.46, 2)}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" font-weight="700" fill="#dc2626">ISBN BARCODE ZONE</text>`,
    `    <text x="${roundTo(barcodeX + barcodeW / 2, 2)}" y="${roundTo(barcodeY + barcodeH * 0.68, 2)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#991b1b">2.00" × 1.20" Clear Area</text>`,
    // 外 bleed 标注
    `    <text x="${roundTo(W - 12, 2)}" y="${roundTo(H - 5, 2)}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="#b91c1c">0.125" Bleed Zone (Red)</text>`,
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n');
}

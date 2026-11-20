import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKdpCoverTemplateSvg,
  calculateKdpPaperbackSpecs,
  getKdpGutterMarginIn,
  mapSpecsToStudioImportParams,
} from './kdp-spine.ts';

test('6x9 100 页米黄纸规格计算精准匹配实测交付样本', () => {
  const specs = calculateKdpPaperbackSpecs({
    trimSizeId: '6x9',
    paperType: 'cream',
    pageCount: 100,
    hasBleed: false,
  });

  assert.equal(specs.spineWidthIn, 0.25);
  assert.equal(specs.fullCoverWidthIn, 12.5);
  assert.equal(specs.fullCoverHeightIn, 9.25);
  assert.equal(specs.fullCoverWidthPx, 3750);
  assert.equal(specs.fullCoverHeightPx, 2775);
  assert.equal(specs.spineTextAllowed, true);
  assert.equal(specs.spineTextSafeWidthIn, 0.125);
  assert.equal(specs.gutterMarginIn, 0.375);
  assert.equal(specs.outsideMarginIn, 0.25);
  assert.equal(specs.interiorWidthIn, 6);
  assert.equal(specs.interiorHeightIn, 9);
});

test('6x9 200 页纯白纸书脊与装订边计算', () => {
  const specs = calculateKdpPaperbackSpecs({
    trimSizeId: '6x9',
    paperType: 'white',
    pageCount: 200,
    hasBleed: true,
  });

  assert.equal(specs.spineWidthIn, 0.4504);
  assert.equal(specs.fullCoverWidthIn, 12.7004);
  assert.equal(specs.gutterMarginIn, 0.5);
  assert.equal(specs.outsideMarginIn, 0.375);
  // 内页出血仅加外边 0.125 与上下 0.25
  assert.equal(specs.interiorWidthIn, 6.125);
  assert.equal(specs.interiorHeightIn, 9.25);
});

test('79 页书脊文字最低门槛与各页数分档装订边边界', () => {
  const at78 = calculateKdpPaperbackSpecs({
    trimSizeId: '6x9',
    paperType: 'cream',
    pageCount: 78,
    hasBleed: false,
  });
  const at79 = calculateKdpPaperbackSpecs({
    trimSizeId: '6x9',
    paperType: 'cream',
    pageCount: 79,
    hasBleed: false,
  });

  assert.equal(at78.spineTextAllowed, false);
  assert.equal(at78.spineTextSafeWidthIn, 0);
  assert.equal(at79.spineTextAllowed, true);
  assert.ok(at79.spineTextSafeWidthIn > 0);

  assert.equal(getKdpGutterMarginIn(150), 0.375);
  assert.equal(getKdpGutterMarginIn(151), 0.5);
  assert.equal(getKdpGutterMarginIn(300), 0.5);
  assert.equal(getKdpGutterMarginIn(301), 0.625);
  assert.equal(getKdpGutterMarginIn(500), 0.625);
  assert.equal(getKdpGutterMarginIn(501), 0.75);
  assert.equal(getKdpGutterMarginIn(700), 0.75);
  assert.equal(getKdpGutterMarginIn(701), 0.875);
});

test('页数越界自动夹紧且映射 Studio 导入参数准确', () => {
  const stdColorLow = calculateKdpPaperbackSpecs({
    trimSizeId: '7x10',
    paperType: 'standard_color',
    pageCount: 40,
    hasBleed: false,
  });
  assert.equal(stdColorLow.pageCount, 72);
  assert.equal(stdColorLow.pageCountClamped, true);
  assert.deepEqual(
    mapSpecsToStudioImportParams({
      trimSizeId: '7x10',
      paperType: 'premium_color',
    }),
    { trim: '6x9', paper: 'white' }
  );
  assert.deepEqual(
    mapSpecsToStudioImportParams({
      trimSizeId: '8.5x11',
      paperType: 'cream',
    }),
    { trim: '8.5x11', paper: 'cream' }
  );
});

test('SVG 封面参考模板包含合法节点、完整尺寸与条码区', () => {
  const specs = calculateKdpPaperbackSpecs({
    trimSizeId: '5.5x8.5',
    paperType: 'cream',
    pageCount: 120,
    hasBleed: false,
  });
  const svg = buildKdpCoverTemplateSvg(specs);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.ok(svg.includes('ISBN BARCODE ZONE'));
  assert.ok(svg.includes('11.5500" × 8.7500"'));
});

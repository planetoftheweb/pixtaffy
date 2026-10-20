import assert from 'node:assert/strict';
import { test } from 'node:test';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';

test('PowerPoint export keeps embedded images after the image-size security upgrade', async () => {
  const deck = new PptxGenJS();
  const slide = deck.addSlide();
  slide.addText('Dependency compatibility', { x: 1, y: 1, w: 5, h: 1 });
  slide.addImage({
    data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOsAAAAASUVORK5CYII=',
    x: 1, y: 2, w: 1, h: 1,
  });
  const zip = await JSZip.loadAsync(await deck.write({ outputType: 'nodebuffer' }));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /Dependency compatibility/);
  assert.match(xml, /<p:pic>/);
  assert.ok(Object.keys(zip.files).some((name) => /^ppt\/media\/.+\.png$/.test(name)));
});

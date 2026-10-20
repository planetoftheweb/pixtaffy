import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

test("image conversion preserves dimensions for PNG, JPEG, and lossless WebP", async () => {
  const input = await sharp({
    create: { width: 8, height: 6, channels: 4, background: "#123456" },
  }).png().toBuffer();
  for (const format of ["png", "jpeg", "webp"] as const) {
    const image = sharp(input);
    const output = format === "webp"
      ? await image.webp({ lossless: true, effort: 4 }).toBuffer()
      : format === "jpeg"
        ? await image.jpeg({ quality: 95 }).toBuffer()
        : await image.png().toBuffer();
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 8);
    assert.equal(metadata.height, 6);
  }
});

const ROMAN_MAP: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
];

export const toRomanNumeral = (num: number): string => {
  if (num <= 0) return '';
  let result = '';
  let remaining = num;
  for (const [value, numeral] of ROMAN_MAP) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
};

export const toMarkLabel = (versionNumber: number): string =>
  `Mark ${toRomanNumeral(versionNumber)}`;

export const toSlug = (text: string, maxLength = 40): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);

export const buildExportFilename = (
  prompt: string,
  versionNumber: number,
  extension: string
): string => {
  const slug = toSlug(prompt) || 'pixtaffy';
  const numeral = toRomanNumeral(versionNumber).toLowerCase();
  return `${slug}-mark-${numeral}.${extension}`;
};

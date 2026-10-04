const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const instagramRoutes = new Set([
  'about', 'accounts', 'api', 'challenge', 'developer', 'developers',
  'direct', 'directory', 'emails', 'explore', 'graphql', 'legal', 'oauth',
  'p', 'privacy', 'push', 'reel', 'reels', 'session', 'share', 'stories',
  'terms', 'web',
]);

function text(value, label, limit) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > limit) {
    throw new RangeError(`${label} must be ${limit} characters or fewer.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(trimmed)) {
    throw new TypeError(`${label} must contain valid, readable text.`);
  }
  return trimmed;
}

function formatDate(value) {
  const date = text(value, 'Date', 10);
  if (!date) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError('Enter the date as YYYY-MM-DD.');
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new RangeError('Choose a valid calendar date.');
  }
  return `${day} ${months[month - 1]} ${yearText}`;
}

function formatServings(value) {
  if (typeof value === 'string') {
    value = value.trim();
    if (!value) return '';
    if (!/^\d{1,4}$/.test(value)) {
      throw new RangeError('Servings must be a whole number from 1 to 1000.');
    }
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000) {
    throw new RangeError('Servings must be a whole number from 1 to 1000.');
  }
  return String(value);
}

export function buildMessage(fields = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('Enquiry details must be an object.');
  }
  const { cakeName = '', date = '', servings = '', notes = '' } = fields;
  const cake = text(cakeName, 'Cake or design', 160);
  const preferredDate = formatDate(date);
  const guests = formatServings(servings);
  const details = text(notes, 'Notes', 1500);
  return [
    "Hello! I'd love to enquire about a custom cake.",
    cake && `Preferred cake or design: ${cake}`,
    preferredDate && `Preferred date: ${preferredDate}`,
    guests && `Servings: ${guests}`,
    details && `A little more about my idea: ${details}`,
    'Could you please let me know the availability and price? Thank you!',
  ].filter(Boolean).join('\n\n');
}

function instagramProfile(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Configure an HTTPS Instagram profile URL.');
  }
  const match = /^https:\/\/(?:www\.)?instagram\.com\/([a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?)\/?$/i.exec(value);
  if (!match || value !== value.trim() || match[1].includes('..') ||
      instagramRoutes.has(match[1].toLowerCase())) {
    throw new TypeError('Configure an HTTPS Instagram profile URL without credentials, query parameters or fragments.');
  }
  return new URL(value).href;
}

export function getContactLink(config, message = '') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Contact configuration must be an object.');
  }
  const { whatsappNumber = '', instagramUrl, instagramHandle } = config;
  if (typeof whatsappNumber !== 'string' ||
      (whatsappNumber !== '' && (!/^[1-9]\d{7,14}$/.test(whatsappNumber) ||
        whatsappNumber !== whatsappNumber.trim()))) {
    throw new TypeError('WhatsApp number must be 8–15 international digits, starting with 1–9, without a plus sign or spaces.');
  }
  if (instagramHandle !== undefined && typeof instagramHandle !== 'string') {
    throw new TypeError('Instagram handle must be text.');
  }
  if (typeof message !== 'string' || /[\uD800-\uDFFF]/u.test(message)) {
    throw new TypeError('The message must be valid Unicode text.');
  }
  const profile = instagramProfile(instagramUrl);
  if (!whatsappNumber) {
    return { href: profile, label: 'Message on Instagram', channel: 'instagram' };
  }
  return {
    href: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`,
    label: 'Message on WhatsApp',
    channel: 'whatsapp',
  };
}

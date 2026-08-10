const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FIX = process.argv.includes('--fix');

// These are authored UI-title classes whose text is not already inside a semantic heading.
// User-provided values such as game names, court names and idea titles are deliberately absent.
const TITLE_CLASSES = new Set([
  'confirmation-detail-label',
  'court-image-title',
  'doc-name',
  'game-detail-label',
  'label',
  'mock-detail-label',
  'notification-title',
  'sms-label',
  'stat-label'
]);

// Non-button elements that are intentionally presented as button controls.
const BUTTON_CLASSES = new Set([
  'back-btn',
  'back-to-game-btn',
  'btn',
  'copy-btn',
  'create-game-btn',
  'lab-button',
  'mock-button',
  'section-nav-btn',
  'ui-button'
]);
const BUTTON_CLASS_PATTERN = new RegExp(
  `<([a-z][\\w-]*)\\b(` +
    `[^>]*\\bclass=["'](?:[^"']*\\s)?(?:${[...BUTTON_CLASSES].join('|')})` +
    `(?=\\s|["'])[^"']*["'][^>]*` +
  `)>([\\s\\S]*?)<\\/\\1>`,
  'gi'
);

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(fullPath);
    return /\.(?:html|js)$/.test(entry.name) ? [fullPath] : [];
  });
}

function visibleText(innerHtml) {
  return innerHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-zA-Z]+|#\d+|#x[\da-fA-F]+);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalizeText(text) {
  // Preserve HTML entities while capitalizing the first letter after whitespace,
  // punctuation, slashes and hyphens. Existing acronym casing is never lowered,
  // and the product name keeps its intentional brand styling.
  return text
    .split(/(&(?:[a-zA-Z]+|#\d+|#x[\da-fA-F]+);)/g)
    .map((part) => {
      if (/^&(?:[a-zA-Z]+|#\d+|#x[\da-fA-F]+);$/.test(part)) return part;
      return part.replace(
        /(^|[\s/–—-])([^A-Za-z]*)([a-z])/g,
        (_match, boundary, punctuation, letter) =>
          boundary + punctuation + letter.toUpperCase()
      );
    })
    .join('')
    // One wordmark only. Allowing "In or Out" as a second permitted form is what let the
    // header and footer drift into showing different casing on the same screen.
    .replace(/\bIn Or Out\b/gi, 'IN or OUT');
}

function titleCaseInnerHtml(innerHtml) {
  return innerHtml
    .split(/(<[^>]+>)/g)
    .map((part) => part.startsWith('<') ? part : capitalizeText(part))
    .join('');
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function checkFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  let source = original;
  const failures = [];
  const relativePath = path.relative(ROOT, filePath);

  function checkPattern(pattern, include = () => true) {
    source = source.replace(pattern, (whole, tag, attributes, innerHtml, offset) => {
      if (innerHtml.includes('${') || !include(tag, attributes, innerHtml)) return whole;
      const corrected = titleCaseInnerHtml(innerHtml);
      if (corrected === innerHtml) return whole;
      if (!FIX) {
        failures.push(
          `${relativePath}:${lineNumber(source, offset)} "${visibleText(innerHtml)}" ` +
          `should be "${visibleText(corrected)}"`
        );
        return whole;
      }
      return whole.replace(innerHtml, corrected);
    });
  }

  checkPattern(/<(title|h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi);
  checkPattern(/<(summary)\b([^>]*)>([\s\S]*?)<\/\1>/gi);
  checkPattern(
    /<(button)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_tag, _attributes, innerHtml) => !/<(?:p|small)\b/i.test(innerHtml)
  );

  // Short labels are field/action titles. Longer prose labels (SMS consent and the
  // organizer-playing sentence) remain sentence case.
  checkPattern(
    /<(label)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_tag, _attributes, innerHtml) => {
      const text = visibleText(innerHtml);
      return text.endsWith(':') || text.split(/\s+/).length <= 8;
    }
  );

  // Short bold lead-ins ending in a colon act as mini-headings inside help and legal copy.
  checkPattern(
    /<(strong)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_tag, _attributes, innerHtml) => {
      const text = visibleText(innerHtml);
      return text.endsWith(':') && text.split(/\s+/).length <= 8;
    }
  );

  checkPattern(
    /<([a-z][\w-]*)\b([^>]*\bclass=["'][^"']+["'][^>]*)>([^<]*)<\/\1>/gi,
    (_tag, attributes) => {
      const classMatch = attributes.match(/\bclass=["']([^"']+)["']/i);
      if (!classMatch) return false;
      return classMatch[1].split(/\s+/).some((className) => TITLE_CLASSES.has(className));
    }
  );

  checkPattern(
    BUTTON_CLASS_PATTERN,
    (tag, _attributes, innerHtml) =>
      tag.toLowerCase() !== 'button' && !/<(?:p|small)\b/i.test(innerHtml)
  );

  if (FIX && source !== original) fs.writeFileSync(filePath, source);
  return failures;
}

const failures = filesUnder(PUBLIC).flatMap(checkFile);

if (FIX) {
  console.log('Title case applied to authored UI titles.');
} else if (failures.length) {
  console.error('Authored UI titles and button labels must capitalize every word:');
  failures.forEach((failure) => console.error(`  ${failure}`));
  process.exitCode = 1;
} else {
  console.log('  PASS  authored UI titles and button labels capitalize every word');
}

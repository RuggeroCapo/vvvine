const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecommendationIdFromTemplate } = require('../lib/recommendation-id.js');

test('replaces only the ASIN in a page recommendation-id template', () => {
  const template = 'APJ6JRA9NG5V4#B0GZMXCZMJ#vine.enrollment.eeff7d47-7896-43ac-9bd9-4a83ebf3a66a';
  const result = buildRecommendationIdFromTemplate(template, 'B0H4KXQTGH');

  assert.equal(
    result,
    'APJ6JRA9NG5V4#B0H4KXQTGH#vine.enrollment.eeff7d47-7896-43ac-9bd9-4a83ebf3a66a'
  );
});

test('keeps extra RFY segments after the ASIN', () => {
  const template = 'APJ6JRA9NG5V4#B0GZMXCZMJ#A1CUSTOMER#vine.enrollment.eeff7d47-7896-43ac-9bd9-4a83ebf3a66a';
  const result = buildRecommendationIdFromTemplate(template, 'B0H4KXQTGH');

  assert.equal(
    result,
    'APJ6JRA9NG5V4#B0H4KXQTGH#A1CUSTOMER#vine.enrollment.eeff7d47-7896-43ac-9bd9-4a83ebf3a66a'
  );
});

test('returns empty string when template or ASIN is missing', () => {
  assert.equal(buildRecommendationIdFromTemplate('', 'B0H4KXQTGH'), '');
  assert.equal(
    buildRecommendationIdFromTemplate(
      'APJ6JRA9NG5V4#B0GZMXCZMJ#vine.enrollment.eeff7d47-7896-43ac-9bd9-4a83ebf3a66a',
      ''
    ),
    ''
  );
  assert.equal(buildRecommendationIdFromTemplate('not-a-recommendation-id', 'B0H4KXQTGH'), '');
});

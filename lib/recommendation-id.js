/**
 * Build Vine recommendation IDs for live-injected tiles.
 * Amazon's data-recommendation-id is marketplace#asin#enrollment..., where
 * marketplace and enrollment are page-fixed and only the ASIN changes.
 */
(function initRecommendationId(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.VineRecommendationId = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRecommendationIdApi() {
  function buildRecommendationIdFromTemplate(template, asin) {
    if (!template || !asin) {
      return '';
    }

    const parts = String(template).split('#');
    if (parts.length < 3) {
      return '';
    }

    parts[1] = asin;
    return parts.join('#');
  }

  return {
    buildRecommendationIdFromTemplate
  };
});

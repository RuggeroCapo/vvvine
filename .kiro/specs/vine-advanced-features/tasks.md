# Vine Advanced Features - Implementation Tasks

## Phase 1: Foundation - Target Filtering & Color Coding

### Task 1.1: Create TargetFilterManager
**Priority:** High
**Estimated Time:** 2 hours

**Subtasks:**
- [ ] Create `managers/target-filter-manager.js` extending BaseManager
- [ ] Implement `loadTargets()` to load from storage
- [ ] Implement `saveTargets(brands, asins)` to persist configuration
- [ ] Implement `isTargetItem(title, asin)` matching logic
- [ ] Implement `matchesBrand(title)` - check first 3 words, case-insensitive
- [ ] Implement `matchesAsin(asin)` - exact match
- [ ] Add default target brands: ["Amazon", "Sony", "MAONO", "Moulinex", "SoundPEATS", "Bose"]
- [ ] Add storage keys: `vineTargetBrands`, `vineTargetAsins`
- [ ] Add event emitters for target matches
- [ ] Test with various brand names and ASINs

**Acceptance:**
- Manager loads and saves target lists
- Brand matching works case-insensitively
- ASIN matching works exactly
- Events emitted when targets found

---

### Task 1.2: Create ColorCodingManager
**Priority:** High
**Estimated Time:** 3 hours

**Subtasks:**
- [ ] Create `managers/color-coding-manager.js` extending BaseManager
- [ ] Implement `processAllItems()` to scan all tiles
- [ ] Implement `processItem(item)` to determine and apply color
- [ ] Implement `determineItemColor(item)` with priority logic:
  - Blue for target items (highest priority)
  - Green for new items
  - Yellow for recent items (< 60s)
  - Default for seen items
- [ ] Implement `applyColor(item, color)` to set background
- [ ] Add CSS classes: `.vine-target-item`, `.vine-recent-item`
- [ ] Integrate with TargetFilterManager for blue items
- [ ] Integrate with NewItemsManager for green items
- [ ] Integrate with SeenItemsManager for recent/seen items
- [ ] Add timestamp tracking for "recent" status
- [ ] Handle MutationObserver for new items added dynamically

**Acceptance:**
- Items colored correctly based on status
- Priority order respected (blue > green > yellow)
- Colors update when status changes
- Performance: < 100ms for full page

---

### Task 1.3: Add CSS Styles for Color Coding
**Priority:** High
**Estimated Time:** 30 minutes

**Subtasks:**
- [ ] Add `.vine-target-item` style to `styles.css` (blue: #00BFFF)
- [ ] Add `.vine-recent-item` style to `styles.css` (yellow: #FFF44D)
- [ ] Update `.vine-new-item` if needed (green: #38FEA7)
- [ ] Ensure colors have sufficient contrast for accessibility
- [ ] Add smooth transitions between color changes
- [ ] Test on different screen sizes

**Acceptance:**
- All color classes render correctly
- Transitions smooth
- Accessible contrast ratios

---

### Task 1.4: Integrate Managers into content.js
**Priority:** High
**Estimated Time:** 1 hour

**Subtasks:**
- [ ] Import TargetFilterManager in content.js
- [ ] Import ColorCodingManager in content.js
- [ ] Add to manager initialization order (after storage, before UI)
- [ ] Set up manager dependencies:
  - ColorCodingManager needs: TargetFilterManager, NewItemsManager, SeenItemsManager
  - TargetFilterManager needs: StorageManager
- [ ] Add to manifest.json script loading order
- [ ] Test initialization sequence
- [ ] Verify no circular dependencies

**Acceptance:**
- Managers initialize in correct order
- Dependencies resolved properly
- No console errors

---

## Phase 2: Visual Feedback - Popups

### Task 2.1: Create PopupNotificationManager
**Priority:** High
**Estimated Time:** 2 hours

**Subtasks:**
- [ ] Create `managers/popup-notification-manager.js` extending BaseManager
- [ ] Implement `showNewItemsPopup(newCount, targetCount)` 
  - Position: top-center (270px from top)
  - Content: "🟩 {newCount} 🟦 {targetCount}"
  - Background: #38FEA7
  - Duration: 5 seconds
- [ ] Implement `showCategoryPopup(increments)`
  - Position: top-center (330px from top)
  - Content: "{emoji} {count} {emoji} {count}"
  - Background: #ffa8f7
  - Duration: 5 seconds
- [ ] Implement `showPurchaseResult(success, message)`
  - Position: bottom-right
  - Content: success/error message
  - Background: #333
  - Duration: 5 seconds
- [ ] Implement `createPopup(content, position, duration, style)` generic method
- [ ] Implement `removePopup(popupId)` with fade-out animation
- [ ] Add auto-dismiss timers
- [ ] Prevent duplicate popups of same type
- [ ] Add z-index management

**Acceptance:**
- Popups appear at correct positions
- Auto-dismiss after timeout
- No duplicate popups
- Smooth animations

---

### Task 2.2: Integrate Popups with ColorCodingManager
**Priority:** High
**Estimated Time:** 1 hour

**Subtasks:**
- [ ] Listen for color coding completion event
- [ ] Count new items (green background)
- [ ] Count target items (blue background)
- [ ] Call `showNewItemsPopup()` if counts > 0
- [ ] Only show popup on initial page load, not on updates
- [ ] Test with various item combinations

**Acceptance:**
- Popup shows correct counts
- Only appears on page load
- Counts match actual colored items

---

### Task 2.3: Add Popup Styles
**Priority:** Medium
**Estimated Time:** 30 minutes

**Subtasks:**
- [ ] Add `.vine-popup` base styles to `styles.css`
- [ ] Add `.vine-popup-new-items` specific styles
- [ ] Add `.vine-popup-category` specific styles
- [ ] Add `.vine-popup-purchase` specific styles
- [ ] Add fade-in/fade-out animations
- [ ] Ensure popups don't block interactions
- [ ] Test on different screen sizes

**Acceptance:**
- All popup types styled correctly
- Animations smooth
- Non-blocking

---

## Phase 3: Category Tracking

### Task 3.1: Create CategoryTrackerManager
**Priority:** Medium
**Estimated Time:** 3 hours

**Subtasks:**
- [ ] Create `managers/category-tracker-manager.js` extending BaseManager
- [ ] Define monitored categories:
  ```javascript
  const MONITORED_CATEGORIES = [
    { name: "Commercio, Industria e Scienza", emoji: "🤖" },
    { nameStart: "Alimentari", emoji: "🍏" }
  ];
  ```
- [x] Implement `extractCategoryCounts()` to parse category tree
  - Find `.parent-node` elements
  - Extract category name from `a.a-link-normal`
  - Extract count from `span` (parse integer)
- [ ] Implement `loadPreviousCounts()` from storage
- [ ] Implement `saveCounts(counts)` to storage
- [ ] Implement `detectIncrements(current, previous)` comparison
- [ ] Add storage keys: `vineCategoryPrevious_{emoji}`
- [ ] Only run on Encore page (check URL contains `queue=encore`)
- [ ] Run on page load with 500ms debounce
- [ ] Emit events for increments detected

**Acceptance:**
- Extracts category counts correctly
- Detects increments accurately
- Only runs on Encore page
- Stores counts persistently

---

### Task 3.2: Integrate Category Tracking with Popups
**Priority:** Medium
**Estimated Time:** 1 hour

**Subtasks:**
- [ ] Listen for category increment events
- [ ] Format increment data for popup display
- [ ] Call `showCategoryPopup(increments)` when increments > 0
- [ ] Test with real category changes
- [ ] Test with no changes (no popup should appear)

**Acceptance:**
- Popup shows when categories increase
- No popup when no changes
- Correct emoji and counts displayed

---

### Task 3.3: Add Category Tracking to content.js
**Priority:** Medium
**Estimated Time:** 30 minutes

**Subtasks:**
- [ ] Import CategoryTrackerManager
- [ ] Add to initialization order (after storage, page detection)
- [ ] Set up dependencies (StorageManager, PopupNotificationManager)
- [ ] Add to manifest.json
- [ ] Test on Encore page
- [ ] Test on non-Encore pages (should not run)

**Acceptance:**
- Manager initializes correctly
- Only active on Encore page
- No errors on other pages

---

## Phase 4: Configuration UI

### Task 4.1: Add Target Configuration to Popup
**Priority:** Medium
**Estimated Time:** 2 hours

**Subtasks:**
- [ ] Add "Target Filtering" section to `popup.html`
- [ ] Add textarea for target brands (comma-separated)
- [ ] Add textarea for target ASINs (comma-separated)
- [ ] Add "Save Targets" button
- [ ] Implement save handler in `popup.js`
- [ ] Load current targets on popup open
- [ ] Send message to content script to reload targets
- [ ] Add validation (trim whitespace, remove empty entries)
- [ ] Add success feedback

**Acceptance:**
- UI renders correctly
- Targets save successfully
- Content script reloads targets
- Validation works

---

### Task 4.2: Add Category Tracking Settings to Popup
**Priority:** Low
**Estimated Time:** 1 hour

**Subtasks:**
- [ ] Add "Category Tracking" section to `popup.html`
- [ ] List monitored categories with emojis
- [ ] Add "Reset Category Counts" button
- [ ] Implement reset handler in `popup.js`
- [ ] Clear stored counts from storage
- [ ] Show confirmation before reset
- [ ] Add success feedback

**Acceptance:**
- Categories listed correctly
- Reset clears counts
- Confirmation works

---

## Phase 5: Performance & Testing

### Task 5.1: Performance Optimization
**Priority:** Medium
**Estimated Time:** 2 hours

**Subtasks:**
- [ ] Profile color coding performance
- [ ] Batch DOM updates where possible
- [ ] Debounce category tracking (500ms)
- [ ] Throttle popup creation
- [ ] Clear old timestamps (> 5 minutes)
- [ ] Measure and log performance metrics

**Acceptance:**
- Color coding < 100ms
- Category tracking < 50ms
- No memory leaks

---

### Task 5.2: Error Handling & Edge Cases
**Priority:** High
**Estimated Time:** 2 hours

**Subtasks:**
- [ ] Handle DOM structure changes
- [ ] Handle network failures gracefully
- [ ] Handle API error responses
- [ ] Add user-friendly error messages
- [ ] Log errors for debugging

**Acceptance:**
- All error cases handled
- User sees helpful messages
- No crashes or undefined errors

---

### Task 5.3: Accessibility Improvements
**Priority:** Medium
**Estimated Time:** 2 hours

**Subtasks:**
- [ ] Add aria-labels to interactive elements
- [ ] Add aria-live regions for popups
- [ ] Test keyboard navigation
- [ ] Add text indicators for colors (not just color)
- [ ] Test with screen reader
- [ ] Ensure sufficient color contrast
- [ ] Add skip links if needed

**Acceptance:**
- WCAG 2.1 AA compliance
- Keyboard navigation works
- Screen reader announces correctly

---

### Task 6.4: Integration Testing
**Priority:** High
**Estimated Time:** 3 hours

**Subtasks:**
- [ ] Test color coding with all status combinations
- [ ] Test purchase flow on all queue types
- [ ] Test category tracking on Encore page
- [ ] Test target filtering with various brands
- [ ] Test popup display and dismissal
- [ ] Test with multiple addresses
- [ ] Test with no addresses
- [ ] Test with network failures
- [ ] Test with invalid CSRF token
- [ ] Test manager initialization order
- [ ] Test cleanup on page navigation

**Acceptance:**
- All features work together
- No conflicts between managers
- Graceful degradation on errors

---

### Task 6.5: Documentation
**Priority:** Low
**Estimated Time:** 1 hour

**Subtasks:**
- [ ] Update README with new features
- [ ] Document configuration options
- [ ] Add screenshots of new features
- [ ] Document keyboard shortcuts
- [ ] Add troubleshooting section
- [ ] Document API endpoints used
- [ ] Add developer notes for maintenance

**Acceptance:**
- README complete and accurate
- Screenshots clear
- Troubleshooting helpful

---

## Summary

**Total Estimated Time:** ~35 hours

**Phase Breakdown:**
- Phase 1 (Foundation): ~6.5 hours
- Phase 2 (Popups): ~3.5 hours
- Phase 3 (Category Tracking): ~4.5 hours
- Phase 4 (Purchase): ~12 hours
- Phase 5 (Configuration): ~4 hours
- Phase 6 (Polish): ~10 hours

**Critical Path:**
1. Task 1.1 → Task 1.2 → Task 1.4 (Foundation)
2. Task 2.1 → Task 2.2 (Popups)
3. Task 4.1 → Task 4.2 → Task 4.4 (Purchase)

**Dependencies:**
- All tasks depend on existing BaseManager and StorageManager
- Color coding depends on target filtering
- Popups depend on color coding and category tracking
- Purchase depends on popups for feedback
- Configuration UI depends on all managers being implemented

**Risk Areas:**
- Amazon API changes (purchase endpoints)
- CSRF token handling
- Performance with large item counts
- Browser compatibility (dialog focus trap)

**Testing Priority:**
1. Purchase flow (highest risk)
2. Color coding (most visible)
3. Category tracking (complex logic)
4. Popups (user experience)
5. Configuration (nice to have)

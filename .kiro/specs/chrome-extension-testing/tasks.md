# Implementation Plan

- [ ] 1. Set up test infrastructure and tooling
  - [ ] 1.1 Install Vitest and fast-check dependencies
    - Run `npm install --save-dev vitest jsdom @vitest/ui fast-check`
    - Create package.json if it doesn't exist
    - _Requirements: 6.1, 6.2_
  
  - [ ] 1.2 Create Vitest configuration
    - Create `vitest.config.js` with jsdom environment
    - Configure test globals and setup files
    - Add test scripts to package.json
    - _Requirements: 6.1, 6.5_
  
  - [ ] 1.3 Create test setup file
    - Create `test/setup.js` for global test configuration
    - Set up Chrome API mocks globally
    - Configure jsdom environment
    - _Requirements: 6.4_

- [ ] 2. Create Chrome API mocks and test utilities
  - [ ] 2.1 Implement MockChromeStorage class
    - Create `test/mocks/chrome-api.js`
    - Implement get, set, remove, and clear methods
    - Match Chrome storage API behavior
    - _Requirements: 6.4_
  
  - [ ] 2.2 Create DOM test helpers
    - Create `test/mocks/dom-helpers.js`
    - Implement createMockItem and createMockGrid functions
    - Add utility functions for DOM manipulation in tests
    - _Requirements: 4.3_
  
  - [ ] 2.3 Create fast-check generators
    - Create `test/generators/index.js`
    - Implement arbitraryTitle, arbitraryUrl, arbitraryBookmark generators
    - Implement arbitrarySeenItemsSet generator
    - _Requirements: 5.5_

- [ ] 3. Refactor StorageManager for testability
  - [ ] 3.1 Extract pure functions from StorageManager
    - Create `managers/storage-utils.js` with pure functions
    - Extract addItemToSet, removeItemFromSet, toggleItemInSet
    - Extract bookmarkMapToArray and bookmarkArrayToMap
    - _Requirements: 4.1, 4.2_
  
  - [ ] 3.2 Update StorageManager to use pure functions
    - Refactor addSeenItem, removeSeenItem, toggleSeenItem to use pure functions
    - Refactor bookmark methods to use conversion functions
    - Maintain existing public API
    - _Requirements: 4.4, 4.5_
  
  - [ ] 3.3 Write unit tests for StorageManager
    - Create `test/unit/storage-manager.test.js`
    - Test addSeenItem, removeSeenItem, toggleSeenItem with specific inputs
    - Test bookmark operations with known data
    - Test error handling for storage failures
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  
  - [ ] 3.4 Write property test for adding items
    - Create `test/properties/storage-properties.test.js`
    - **Property 1: Adding items maintains Set consistency**
    - **Validates: Requirements 1.1**
  
  - [ ] 3.5 Write property test for removing items
    - **Property 2: Removing items maintains Set consistency**
    - **Validates: Requirements 1.2**
  
  - [ ] 3.6 Write property test for toggle idempotence
    - **Property 3: Toggle is idempotent after two applications**
    - **Validates: Requirements 1.3**
  
  - [ ] 3.7 Write property test for bulk add count
    - **Property 4: Bulk add returns correct count**
    - **Validates: Requirements 1.4**
  
  - [ ] 3.8 Write property test for bookmark round-trip
    - **Property 5: Bookmark storage round-trip preserves data**
    - **Validates: Requirements 1.5**
  
  - [ ] 3.9 Write property test for Set uniqueness
    - **Property 15: Set operations maintain uniqueness**
    - **Validates: Requirements 5.1**

- [ ] 4. Refactor FilterManager for testability
  - [ ] 4.1 Extract pure matching functions
    - Create `managers/filter-utils.js` with pure functions
    - Extract itemMatchesQuery, basicTextMatch, wordMatch, partialWordMatch
    - Extract filterItemsByQuery function
    - _Requirements: 4.1, 4.2_
  
  - [ ] 4.2 Update FilterManager to use pure functions
    - Refactor filterItems to use extracted matching logic
    - Separate DOM manipulation from matching logic
    - Maintain existing public API
    - _Requirements: 4.4, 4.5_
  
  - [ ] 4.3 Write unit tests for FilterManager
    - Create `test/unit/filter-manager.test.js`
    - Test filtering with specific queries and titles
    - Test edge cases: empty query, special characters, very long strings
    - Test filter persistence
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [ ] 4.4 Write property test for substring matching
    - Add to `test/properties/filter-properties.test.js`
    - **Property 6: Substring matching is consistent**
    - **Validates: Requirements 2.1**
  
  - [ ] 4.5 Write property test for multi-word queries
    - **Property 7: Multi-word queries require all words to match**
    - **Validates: Requirements 2.2**
  
  - [ ] 4.6 Write property test for partial word matching
    - **Property 8: Partial word matching works with prefixes**
    - **Validates: Requirements 2.4**
  
  - [ ] 4.7 Write property test for filter persistence
    - **Property 9: Filter persistence maintains query**
    - **Validates: Requirements 2.5**

- [ ] 5. Test EventBus communication system
  - [ ] 5.1 Write unit tests for EventBus
    - Create `test/unit/event-bus.test.js`
    - Test on, off, emit with specific callbacks
    - Test error handling in callbacks
    - Test callback execution order
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [ ] 5.2 Write property test for callback invocation
    - Create `test/properties/event-properties.test.js`
    - **Property 10: All callbacks are invoked on emit**
    - **Validates: Requirements 3.1**
  
  - [ ] 5.3 Write property test for callback registration
    - **Property 11: Registration adds callback to list**
    - **Validates: Requirements 3.2**
  
  - [ ] 5.4 Write property test for registration round-trip
    - **Property 12: Registration then unregistration is identity**
    - **Validates: Requirements 3.3**
  
  - [ ] 5.5 Write property test for error isolation
    - **Property 13: Error in callback doesn't prevent others**
    - **Validates: Requirements 3.4**
  
  - [ ] 5.6 Write property test for execution order
    - **Property 14: Callbacks execute in registration order**
    - **Validates: Requirements 3.5**
  
  - [ ] 5.7 Write property test for data consistency
    - **Property 16: Event data is consistent across callbacks**
    - **Validates: Requirements 5.4**

- [ ] 6. Test BaseManager utility methods
  - [ ] 6.1 Write unit tests for BaseManager
    - Create `test/unit/base-manager.test.js`
    - Test extractItemTitle with various DOM structures
    - Test waitForElement with existing elements
    - Test waitForElement with delayed elements
    - Test waitForElement timeout behavior
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [ ] 6.2 Write property test for title extraction
    - **Property 17: Title extraction trims whitespace**
    - **Validates: Requirements 7.1**
  
  - [ ] 6.3 Write property test for event delegation
    - **Property 18: Event emission delegates to EventBus**
    - **Validates: Requirements 7.5**

- [ ] 7. Test main controller initialization
  - [ ] 7.1 Write integration tests for AmazonVineEnhancer
    - Create `test/unit/main-controller.test.js`
    - Test manager creation in correct order
    - Test cross-manager dependency setup
    - Test global variable exposure
    - Test auto-navigation initialization
    - _Requirements: 8.1, 8.2, 8.3, 8.5_
  
  - [ ] 7.2 Write property test for initialization resilience
    - Create `test/properties/integration-properties.test.js`
    - **Property 19: Failed manager doesn't prevent others**
    - **Validates: Requirements 8.4**

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Add test documentation and scripts
  - [ ] 9.1 Update package.json with test scripts
    - Add "test" script to run all tests
    - Add "test:watch" script for development
    - Add "test:coverage" script for coverage reports
    - Add "test:ui" script for Vitest UI
    - _Requirements: 6.2, 6.5_
  
  - [ ] 9.2 Create testing documentation
    - Create `test/README.md` explaining test structure
    - Document how to run tests
    - Document how to write new tests
    - Include examples of unit and property tests
    - _Requirements: 6.2, 6.3_
  
  - [ ] 9.3 Add test coverage reporting
    - Configure Vitest coverage with c8
    - Set coverage thresholds in vitest.config.js
    - Document coverage goals
    - _Requirements: 6.2_

- [ ] 10. Final checkpoint - Verify all functionality
  - Ensure all tests pass, ask the user if questions arise.

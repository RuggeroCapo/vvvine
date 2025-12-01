# Design Document

## Overview

This design document outlines the approach for adding comprehensive testing to the Amazon Vine Efficiency Enhancer Chrome extension and refactoring code to improve testability. The extension uses a manager-based architecture where each manager handles a specific domain (storage, filtering, UI, etc.). The design focuses on:

1. **Separation of Concerns**: Extracting pure business logic from DOM-dependent code
2. **Dependency Injection**: Making managers testable by injecting dependencies
3. **Test Infrastructure**: Setting up Vitest with Chrome API mocks
4. **Property-Based Testing**: Using fast-check for comprehensive input coverage
5. **Minimal Refactoring**: Preserving existing functionality while improving testability

The testing strategy employs both unit tests for specific behaviors and property-based tests for universal correctness properties.

## Architecture

### Current Architecture

The extension follows a modular manager pattern:

```
AmazonVineEnhancer (Main Controller)
├── BaseManager (Abstract base class)
├── StorageManager (Chrome storage operations)
├── FilterManager (Client-side filtering)
├── SeenItemsManager (Visual marking)
├── BookmarkManager (Bookmark management)
├── UIManager (Control panel)
├── KeyboardManager (Keyboard shortcuts)
├── PageManager (Navigation & auto-scroll)
└── EventBus (Manager communication)
```

### Testing Architecture

The testing architecture will introduce:

1. **Test Utilities** (`test/utils/`):
   - Chrome API mocks
   - DOM test helpers
   - Test data generators

2. **Unit Tests** (`test/unit/`):
   - Manager-specific test files
   - Pure function tests
   - Event system tests

3. **Property Tests** (`test/properties/`):
   - Data transformation properties
   - Invariant verification
   - Round-trip properties

4. **Refactored Code Structure**:
   - Extract pure functions to separate modules
   - Use dependency injection for DOM access
   - Maintain backward compatibility

## Components and Interfaces

### 1. Test Configuration

**File**: `vitest.config.js`

```javascript
export default {
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js']
  }
}
```

### 2. Chrome API Mocks

**File**: `test/mocks/chrome-api.js`

```javascript
export class MockChromeStorage {
  constructor() {
    this.data = {}
  }
  
  async get(keys) {
    // Returns stored data for given keys
  }
  
  async set(items) {
    // Stores items in mock storage
  }
  
  async remove(keys) {
    // Removes items from mock storage
  }
}
```

### 3. Refactored StorageManager

**Approach**: Extract pure functions for data transformations

```javascript
// Pure functions (easily testable)
export function addItemToSet(set, item) {
  const newSet = new Set(set)
  newSet.add(item)
  return newSet
}

export function removeItemFromSet(set, item) {
  const newSet = new Set(set)
  newSet.delete(item)
  return newSet
}

// Manager uses pure functions + storage I/O
class StorageManager {
  async addSeenItem(title) {
    this.seenItems = addItemToSet(this.seenItems, title)
    await this.saveSeenItems()
  }
}
```

### 4. Refactored FilterManager

**Approach**: Separate matching logic from DOM manipulation

```javascript
// Pure matching functions
export function itemMatchesQuery(title, query) {
  // Returns boolean without DOM access
}

export function filterItemsByQuery(items, query) {
  // Returns filtered array without modifying DOM
}

// Manager handles DOM updates
class FilterManager {
  filterItems(query) {
    const items = this.getItems() // DOM access
    const matches = filterItemsByQuery(items, query) // Pure logic
    this.updateDOM(matches) // DOM manipulation
  }
}
```

### 5. Test Data Generators

**File**: `test/generators/index.js`

```javascript
import fc from 'fast-check'

export const arbitraryTitle = fc.string({ minLength: 1, maxLength: 200 })
export const arbitraryTitleSet = fc.array(arbitraryTitle).map(arr => new Set(arr))
export const arbitraryBookmark = fc.record({
  title: arbitraryTitle,
  url: fc.webUrl(),
  pageNumber: fc.integer({ min: 1, max: 100 }),
  timestamp: fc.integer({ min: 0 })
})
```

## Data Models

### SeenItems Storage Model

```javascript
{
  vineSeenTitles: string[]  // Array of item titles marked as seen
}
```

### Bookmarks Storage Model

```javascript
{
  vineBookmarks: Array<{
    title: string,
    url: string,
    pageNumber: number,
    pageUrl: string,
    timestamp: number
  }>
}
```

### EventBus Event Model

```javascript
{
  eventName: string,
  callbacks: Function[],
  data: any  // Event payload
}
```

### Filter State Model

```javascript
{
  currentFilter: string,
  filteredItems: Set<HTMLElement>,
  vineSearchQuery: string  // Persisted in storage
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Storage Manager Properties

**Property 1: Adding items maintains Set consistency**
*For any* title string, when added to the StorageManager, the title should appear in the internal Set and the item should be retrievable via isItemSeen.
**Validates: Requirements 1.1**

**Property 2: Removing items maintains Set consistency**
*For any* Set of seen items and any item in that Set, removing the item should result in isItemSeen returning false for that item.
**Validates: Requirements 1.2**

**Property 3: Toggle is idempotent after two applications**
*For any* title and any initial state, toggling the seen status twice should return the item to its original state.
**Validates: Requirements 1.3**

**Property 4: Bulk add returns correct count**
*For any* array of titles and any existing Set of seen items, adding the array should return a count equal to the number of titles not already in the Set.
**Validates: Requirements 1.4**

**Property 5: Bookmark storage round-trip preserves data**
*For any* Map of bookmarks, converting to array (for storage) and back to Map should produce an equivalent Map with the same entries.
**Validates: Requirements 1.5**

### Filter Manager Properties

**Property 6: Substring matching is consistent**
*For any* title and query where the query is a substring of the title, itemMatchesQuery should return true.
**Validates: Requirements 2.1**

**Property 7: Multi-word queries require all words to match**
*For any* title and multi-word query, itemMatchesQuery should return true only if every word in the query appears in the title.
**Validates: Requirements 2.2**

**Property 8: Partial word matching works with prefixes**
*For any* title containing a word and any prefix of that word (length >= 3), itemMatchesQuery should return true when using partial matching.
**Validates: Requirements 2.4**

**Property 9: Filter persistence maintains query**
*For any* filter query string, after filtering items, retrieving the stored query should return the same string.
**Validates: Requirements 2.5**

### EventBus Properties

**Property 10: All callbacks are invoked on emit**
*For any* event name and any set of registered callbacks, emitting the event should invoke all callbacks exactly once.
**Validates: Requirements 3.1**

**Property 11: Registration adds callback to list**
*For any* event name and callback function, after registration, the callback should be in the event's callback list.
**Validates: Requirements 3.2**

**Property 12: Registration then unregistration is identity**
*For any* event name and callback, registering then immediately unregistering should leave the callback list unchanged from its original state.
**Validates: Requirements 3.3**

**Property 13: Error in callback doesn't prevent others**
*For any* event with multiple callbacks where one throws an error, all other callbacks should still execute.
**Validates: Requirements 3.4**

**Property 14: Callbacks execute in registration order**
*For any* sequence of callback registrations, emitting the event should execute callbacks in the same order they were registered.
**Validates: Requirements 3.5**

### Data Consistency Properties

**Property 15: Set operations maintain uniqueness**
*For any* sequence of add and remove operations on the StorageManager, the internal Set should never contain duplicate titles.
**Validates: Requirements 5.1**

**Property 16: Event data is consistent across callbacks**
*For any* event emission with data payload, all callbacks should receive a reference to the same data object.
**Validates: Requirements 5.4**

### BaseManager Properties

**Property 17: Title extraction trims whitespace**
*For any* text content with leading or trailing whitespace, extractItemTitle should return the text with whitespace removed.
**Validates: Requirements 7.1**

**Property 18: Event emission delegates to EventBus**
*For any* event name and data, calling emit on a BaseManager instance should result in the EventBus receiving the same event and data.
**Validates: Requirements 7.5**

### Initialization Properties

**Property 19: Failed manager doesn't prevent others**
*For any* manager that throws during initialization, all other managers should still complete their initialization successfully.
**Validates: Requirements 8.4**

## Error Handling

### Storage Errors

- **Chrome Storage API Failures**: Wrap all chrome.storage calls in try-catch blocks. Log errors and emit error events for UI feedback.
- **Data Corruption**: Validate data structure on load. If invalid, reset to empty state and log warning.
- **Quota Exceeded**: Catch quota errors and emit event to notify user to clear old data.

### Filter Errors

- **Invalid Query Patterns**: Sanitize query input to prevent regex injection or performance issues.
- **DOM Access Errors**: Gracefully handle missing elements by returning empty arrays.

### Event System Errors

- **Callback Exceptions**: Catch and log errors in callbacks without stopping other callbacks.
- **Memory Leaks**: Implement cleanup methods to remove event listeners when managers are destroyed.

### Test Environment Errors

- **Missing Mocks**: Provide default mock implementations for all Chrome APIs.
- **Async Timing**: Use proper async/await patterns and timeouts in tests.
- **DOM Cleanup**: Reset DOM state between tests to prevent interference.

## Testing Strategy

### Unit Testing Approach

Unit tests will verify specific behaviors and edge cases:

1. **Manager Initialization**: Test that each manager initializes correctly with default state
2. **Storage Operations**: Test specific add/remove/toggle scenarios with known inputs
3. **Filter Matching**: Test edge cases like empty queries, special characters, very long strings
4. **Event System**: Test registration, unregistration, and emission with specific callbacks
5. **Error Handling**: Test that errors are caught and handled appropriately

**Unit Test Framework**: Vitest with jsdom environment

**Example Unit Test**:
```javascript
describe('StorageManager', () => {
  it('should add a new seen item', async () => {
    const storage = new StorageManager()
    await storage.init()
    
    const result = storage.addSeenItem('Test Product')
    
    expect(result).toBe(true)
    expect(storage.isItemSeen('Test Product')).toBe(true)
  })
})
```

### Property-Based Testing Approach

Property-based tests will verify universal properties across many random inputs:

1. **Data Transformations**: Verify round-trip properties for serialization/deserialization
2. **Set Operations**: Verify invariants like uniqueness and consistency
3. **Filter Matching**: Verify matching logic across diverse title and query combinations
4. **Event System**: Verify callback execution and ordering across random event patterns
5. **Idempotence**: Verify operations that should be idempotent (like toggle twice)

**Property Test Framework**: fast-check (JavaScript property-based testing library)

**Configuration**: Each property test will run a minimum of 100 iterations with randomly generated inputs.

**Test Tagging**: Each property-based test MUST include a comment tag in this format:
```javascript
// Feature: chrome-extension-testing, Property 1: Adding items maintains Set consistency
```

**Example Property Test**:
```javascript
import fc from 'fast-check'

describe('StorageManager Properties', () => {
  it('Property 3: Toggle is idempotent after two applications', () => {
    // Feature: chrome-extension-testing, Property 3: Toggle is idempotent after two applications
    fc.assert(
      fc.property(fc.string(), async (title) => {
        const storage = new StorageManager()
        await storage.init()
        
        const initialState = storage.isItemSeen(title)
        storage.toggleSeenItem(title)
        storage.toggleSeenItem(title)
        const finalState = storage.isItemSeen(title)
        
        expect(finalState).toBe(initialState)
      }),
      { numRuns: 100 }
    )
  })
})
```

### Test Organization

```
test/
├── setup.js                    # Test environment setup
├── mocks/
│   ├── chrome-api.js          # Chrome API mocks
│   └── dom-helpers.js         # DOM test utilities
├── generators/
│   └── index.js               # fast-check generators
├── unit/
│   ├── storage-manager.test.js
│   ├── filter-manager.test.js
│   ├── event-bus.test.js
│   ├── base-manager.test.js
│   └── main-controller.test.js
└── properties/
    ├── storage-properties.test.js
    ├── filter-properties.test.js
    ├── event-properties.test.js
    └── integration-properties.test.js
```

### Refactoring for Testability

**Principles**:
1. Extract pure functions that don't depend on DOM or browser APIs
2. Use dependency injection for DOM accessors and Chrome APIs
3. Separate business logic from side effects
4. Maintain backward compatibility with existing code

**Refactoring Steps**:
1. Identify pure logic in each manager
2. Extract to separate functions or modules
3. Update manager to use extracted functions
4. Add tests for extracted functions
5. Verify existing functionality still works

**Example Refactoring**:

Before:
```javascript
class FilterManager {
  filterItems(query) {
    const items = document.querySelectorAll('.vvp-item-tile')
    items.forEach(item => {
      const title = item.querySelector('.a-truncate-full').textContent
      if (title.toLowerCase().includes(query.toLowerCase())) {
        item.style.display = ''
      } else {
        item.style.display = 'none'
      }
    })
  }
}
```

After:
```javascript
// Pure function - easily testable
export function itemMatchesQuery(title, query) {
  return title.toLowerCase().includes(query.toLowerCase())
}

// Manager handles DOM
class FilterManager {
  filterItems(query) {
    const items = document.querySelectorAll('.vvp-item-tile')
    items.forEach(item => {
      const title = item.querySelector('.a-truncate-full').textContent
      if (itemMatchesQuery(title, query)) {
        item.style.display = ''
      } else {
        item.style.display = 'none'
      }
    })
  }
}
```

### Test Coverage Goals

- **Unit Test Coverage**: Aim for 80%+ coverage of business logic
- **Property Test Coverage**: All correctness properties must have corresponding property tests
- **Integration Coverage**: Test manager initialization and cross-manager communication
- **Edge Case Coverage**: Test boundary conditions, empty inputs, and error scenarios

### Continuous Testing

- Tests should run on every code change during development
- Use Vitest watch mode for rapid feedback
- All tests must pass before committing code
- Property tests should be run with increased iterations (1000+) before releases

## Implementation Notes

### Chrome API Mocking Strategy

Create a comprehensive mock for chrome.storage.local:

```javascript
export class MockChromeStorage {
  constructor() {
    this.data = {}
  }
  
  async get(keys) {
    if (typeof keys === 'string') {
      return { [keys]: this.data[keys] }
    }
    if (Array.isArray(keys)) {
      const result = {}
      keys.forEach(key => {
        if (key in this.data) {
          result[key] = this.data[key]
        }
      })
      return result
    }
    return { ...this.data }
  }
  
  async set(items) {
    Object.assign(this.data, items)
  }
  
  async remove(keys) {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    keyArray.forEach(key => delete this.data[key])
  }
  
  clear() {
    this.data = {}
  }
}
```

### DOM Test Utilities

Create helpers for creating test DOM structures:

```javascript
export function createMockItem(title) {
  const item = document.createElement('div')
  item.className = 'vvp-item-tile'
  
  const titleElement = document.createElement('span')
  titleElement.className = 'a-truncate-full'
  titleElement.textContent = title
  
  item.appendChild(titleElement)
  return item
}

export function createMockGrid(items) {
  const grid = document.createElement('div')
  grid.id = 'vvp-items-grid'
  items.forEach(item => grid.appendChild(item))
  return grid
}
```

### Test Data Generators

Use fast-check to generate realistic test data:

```javascript
import fc from 'fast-check'

export const arbitraryTitle = fc.string({ 
  minLength: 1, 
  maxLength: 200 
})

export const arbitraryUrl = fc.webUrl()

export const arbitraryBookmark = fc.record({
  title: arbitraryTitle,
  url: arbitraryUrl,
  pageNumber: fc.integer({ min: 1, max: 100 }),
  pageUrl: arbitraryUrl,
  timestamp: fc.integer({ min: 0 })
})

export const arbitrarySeenItemsSet = fc.array(arbitraryTitle)
  .map(arr => new Set(arr))
```

### Backward Compatibility

All refactoring must maintain the existing public API:

- Manager class names and methods remain unchanged
- Event names and payloads remain unchanged
- Global variables (window.vineEnhancer, etc.) remain unchanged
- Existing functionality continues to work identically

### Performance Considerations

- Property tests with 100+ iterations should complete in < 5 seconds
- Unit tests should complete in < 1 second total
- Mocks should be lightweight and not impact test performance
- Use test.concurrent for independent tests to parallelize execution

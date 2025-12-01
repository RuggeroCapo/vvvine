# Requirements Document

## Introduction

This document outlines the requirements for adding comprehensive testing to the Amazon Vine Efficiency Enhancer Chrome extension and refactoring code to improve testability. The extension currently has a manager-based architecture with multiple components handling storage, filtering, UI, keyboard navigation, and page management. The goal is to ensure code correctness through unit tests and property-based tests while maintaining the existing functionality.

## Glossary

- **Extension**: The Amazon Vine Efficiency Enhancer Chrome extension
- **Manager**: A modular component class that handles a specific domain of functionality (e.g., StorageManager, FilterManager)
- **BaseManager**: The parent class that all managers inherit from, providing common functionality
- **EventBus**: A global event system for manager-to-manager communication
- **Chrome Storage API**: Browser API for persistent data storage
- **DOM**: Document Object Model - the HTML structure of the web page
- **Business Logic**: Core functionality independent of UI/DOM manipulation
- **Test Suite**: Collection of automated tests that verify code correctness
- **Property-Based Test (PBT)**: A test that verifies a property holds across many randomly generated inputs
- **Unit Test**: A test that verifies specific behavior of a single function or component
- **Test Runner**: The framework that executes tests (e.g., Jest, Vitest)
- **Mock**: A simulated object used in testing to replace real dependencies

## Requirements

### Requirement 1

**User Story:** As a developer, I want to test the StorageManager in isolation, so that I can verify data persistence logic works correctly without browser dependencies.

#### Acceptance Criteria

1. WHEN the StorageManager adds a seen item THEN the system SHALL store the item in the internal Set and persist it to storage
2. WHEN the StorageManager removes a seen item THEN the system SHALL remove the item from the internal Set and update storage
3. WHEN the StorageManager toggles a seen item THEN the system SHALL add the item if not present or remove it if present
4. WHEN the StorageManager adds multiple seen items THEN the system SHALL add all new items and return the count of items added
5. WHEN the StorageManager loads bookmarks THEN the system SHALL convert the stored array to a Map with title as the key

### Requirement 2

**User Story:** As a developer, I want to test the FilterManager's matching logic, so that I can ensure search queries correctly identify matching items.

#### Acceptance Criteria

1. WHEN a filter query matches text within an item title THEN the system SHALL return true for that item
2. WHEN a filter query contains multiple words THEN the system SHALL return true only if all words match the title
3. WHEN a filter query is empty THEN the system SHALL return true for all items
4. WHEN a filter query uses partial word matching THEN the system SHALL match words that start with the query
5. WHILE filtering items, THE system SHALL preserve the original filter query in storage for persistence across pages

### Requirement 3

**User Story:** As a developer, I want to test the EventBus communication system, so that I can verify managers communicate correctly.

#### Acceptance Criteria

1. WHEN an event is emitted THEN the system SHALL invoke all registered callbacks for that event
2. WHEN a callback is registered for an event THEN the system SHALL add it to the event's callback list
3. WHEN a callback is unregistered THEN the system SHALL remove it from the event's callback list
4. WHEN a callback throws an error THEN the system SHALL log the error and continue executing other callbacks
5. WHEN multiple callbacks are registered for the same event THEN the system SHALL execute them in registration order

### Requirement 4

**User Story:** As a developer, I want to refactor DOM-dependent code, so that business logic can be tested without a browser environment.

#### Acceptance Criteria

1. WHEN extracting business logic from managers THEN the system SHALL separate pure functions from DOM manipulation
2. WHEN a manager method requires DOM access THEN the system SHALL use dependency injection to provide DOM accessors
3. WHEN testing business logic THEN the system SHALL not require a real DOM or browser APIs
4. WHEN refactoring is complete THEN the system SHALL maintain all existing functionality without behavioral changes
5. WHILE refactoring, THE system SHALL preserve the existing manager architecture and event system

### Requirement 5

**User Story:** As a developer, I want property-based tests for data transformations, so that I can verify correctness across many input variations.

#### Acceptance Criteria

1. WHEN testing storage operations THEN the system SHALL verify that adding and removing items maintains Set consistency
2. WHEN testing filter matching THEN the system SHALL verify that match results are consistent regardless of input order
3. WHEN testing bookmark operations THEN the system SHALL verify that the Map-to-Array conversion is reversible
4. WHEN testing event emission THEN the system SHALL verify that all registered callbacks receive the emitted data
5. WHEN running property tests THEN the system SHALL execute at least 100 iterations with random inputs

### Requirement 6

**User Story:** As a developer, I want a test setup with proper tooling, so that I can run tests efficiently during development.

#### Acceptance Criteria

1. WHEN the test framework is configured THEN the system SHALL support both unit tests and property-based tests
2. WHEN tests are executed THEN the system SHALL provide clear output showing passed and failed tests
3. WHEN a test fails THEN the system SHALL display the specific assertion that failed and the input values
4. WHEN running tests THEN the system SHALL mock Chrome APIs to avoid browser dependencies
5. WHILE developing, THE system SHALL allow running tests in watch mode for rapid feedback

### Requirement 7

**User Story:** As a developer, I want tests for the BaseManager utility methods, so that I can ensure common functionality works correctly.

#### Acceptance Criteria

1. WHEN extracting an item title from a DOM element THEN the system SHALL return the trimmed text content
2. WHEN waiting for an element that exists THEN the system SHALL resolve immediately with the element
3. WHEN waiting for an element that appears later THEN the system SHALL resolve when the element is added to the DOM
4. WHEN waiting for an element that never appears THEN the system SHALL reject after the timeout period
5. WHEN the BaseManager emits an event THEN the system SHALL delegate to the global EventBus

### Requirement 8

**User Story:** As a developer, I want integration tests for manager initialization, so that I can verify the complete startup sequence works correctly.

#### Acceptance Criteria

1. WHEN the AmazonVineEnhancer initializes THEN the system SHALL create all required managers in the correct order
2. WHEN managers are initialized THEN the system SHALL set up cross-manager dependencies correctly
3. WHEN the initialization completes THEN the system SHALL expose managers globally for debugging
4. WHEN a manager fails to initialize THEN the system SHALL log the error and continue with other managers
5. WHEN auto-navigation is enabled in storage THEN the system SHALL enable it in the PageManager after initialization

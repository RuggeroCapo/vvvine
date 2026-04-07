# Vine Advanced Features - Requirements

## Overview
Implement advanced features to enhance Amazon Vine item discovery. Focus on visual indicators, target filtering, and passive category tracking.

## Goals
- Improve item discovery with color-coded highlighting system
- Track target brands/ASINs automatically
- Monitor category changes passively (always-on, not part of monitoring mode)
- Provide visual feedback through non-intrusive popups

## Acceptance Criteria

### AC1: Target Brand/ASIN Filtering
**Given** I have configured target brands and ASINs
**When** items are loaded on the page
**Then** items matching target brands should be highlighted in blue
**And** items matching target ASINs should be highlighted in blue
**And** a popup should show the count of blue (target) items found

### AC2: Color Coding System
**Given** items are loaded on the page
**When** the extension processes them
**Then** new items (never seen) should have green background
**And** recent items (seen < 60s ago) should have yellow background
**And** target items should have blue background
**And** regular seen items should remain gray/default

### AC3: Visual Popups for New/Target Items
**Given** new or target items are detected
**When** the page loads
**Then** a popup should appear at top-center showing:
- 🟩 count for new items
- 🟦 count for target items
**And** the popup should auto-dismiss after 5 seconds

### AC4: Category Tracking (Always-On)
**Given** I am on the Encore page with category tree
**When** the page loads
**Then** the extension should compare current category counts with stored values
**And** if any monitored category has increased, show a popup with increments
**And** the popup should display: emoji + increment count (e.g., "🤖 5 🍏 3")
**And** this should work independently of monitoring mode

### AC5: Configurable Targets
**Given** I want to customize target brands/ASINs
**When** I open the popup settings
**Then** I should see inputs for:
- Target brands (comma-separated list)
- Target ASINs (comma-separated list)
**And** changes should be saved and applied immediately

## Non-Functional Requirements

### Performance
- Color coding should not delay page load by more than 100ms
- Category tracking should complete within 50ms

### Usability
- Popups should not block interaction with items
- Color coding should be accessible (consider colorblind users)

### Reliability
- Category tracking should handle errors gracefully
- Failed operations should not break the extension

## Out of Scope
- Telegram notifications (excluded per user request)
- One-click purchasing functionality (removed due to Amazon changes)
- Background service worker (keeping it simple)
- Rate limiting (user wants speed)
- Multi-page purchase automation

## Dependencies
- Existing managers: storage, seen-items, filter, ui, new-items
- Amazon Vine API endpoints
- CSRF token from page

## Assumptions
- User has valid Amazon Vine account
- Extension runs only on user's personal browser
- Amazon API endpoints remain stable
- User accepts risk of one-click purchasing

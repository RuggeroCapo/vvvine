# Vine Advanced Features - Requirements

## Overview
Implement advanced features from Tampermonkey script to enhance Amazon Vine item discovery and acquisition speed. Focus on visual indicators, target filtering, one-click purchasing, and passive category tracking.

## Goals
- Enable fast item acquisition with one-click purchase (rocket button)
- Improve item discovery with color-coded highlighting system
- Track target brands/ASINs automatically
- Monitor category changes passively (always-on, not part of monitoring mode)
- Provide visual feedback through non-intrusive popups

## Acceptance Criteria

### AC1: Rocket Button (One-Click Purchase)
**Given** I am on a Vine queue page (Potluck, Encore, Last Chance)
**When** I see an item tile
**Then** a rocket button (🚀) should appear on the top-right corner
**And** clicking it should show a small confirmation dialog
**And** confirming should purchase the item via Amazon API
**And** visual feedback should indicate success/failure

### AC2: Target Brand/ASIN Filtering
**Given** I have configured target brands and ASINs
**When** items are loaded on the page
**Then** items matching target brands should be highlighted in blue
**And** items matching target ASINs should be highlighted in blue
**And** a popup should show the count of blue (target) items found

### AC3: Color Coding System
**Given** items are loaded on the page
**When** the extension processes them
**Then** new items (never seen) should have green background
**And** recent items (seen < 60s ago) should have yellow background
**And** target items should have blue background
**And** regular seen items should remain gray/default

### AC4: Visual Popups for New/Target Items
**Given** new or target items are detected
**When** the page loads
**Then** a popup should appear at top-center showing:
- 🟩 count for new items
- 🟦 count for target items
**And** the popup should auto-dismiss after 5 seconds

### AC5: Category Tracking (Always-On)
**Given** I am on the Encore page with category tree
**When** the page loads
**Then** the extension should compare current category counts with stored values
**And** if any monitored category has increased, show a popup with increments
**And** the popup should display: emoji + increment count (e.g., "🤖 5 🍏 3")
**And** this should work independently of monitoring mode

### AC6: Configurable Targets
**Given** I want to customize target brands/ASINs
**When** I open the popup settings
**Then** I should see inputs for:
- Target brands (comma-separated list)
- Target ASINs (comma-separated list)
**And** changes should be saved and applied immediately

### AC7: Address Selection for Purchase
**Given** I have multiple delivery addresses
**When** the rocket button is available
**Then** I should be able to select which address to use
**And** the selection should persist across pages

### AC8: Purchase Confirmation Dialog
**Given** I click the rocket button
**When** the confirmation dialog appears
**Then** it should show:
- Item title (first 4 words)
- Confirm/Cancel buttons
**And** it should be fast to interact with (keyboard shortcuts)
**And** pressing Enter should confirm, Escape should cancel

## Non-Functional Requirements

### Performance
- Color coding should not delay page load by more than 100ms
- Category tracking should complete within 50ms
- Rocket button should appear within 200ms of page load

### Usability
- Confirmation dialog should be dismissible with keyboard
- Popups should not block interaction with items
- Color coding should be accessible (consider colorblind users)

### Reliability
- Purchase API calls should handle errors gracefully
- CSRF token should be refreshed if expired
- Failed purchases should not mark items as purchased

### Security
- CSRF tokens should not be logged
- Address IDs should be stored securely
- API calls should validate responses

## Out of Scope
- Telegram notifications (excluded per user request)
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

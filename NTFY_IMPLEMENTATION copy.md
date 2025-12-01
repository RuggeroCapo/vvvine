# ntfy.sh Implementation Guide

## Overview

The monitoring system now uses **ntfy.sh** for sending notifications about new Amazon Vine items. This provides cross-device notifications without requiring browser permissions.

## What is ntfy.sh?

ntfy.sh is a simple HTTP-based pub-sub notification service:
- ✅ No sign-up or authentication required
- ✅ Free and open source
- ✅ Works across devices (phone, desktop, tablet)
- ✅ Simple HTTP API
- ✅ Notifications work even when browser is closed
- ✅ Supports rich notifications with priority, tags, and actions

## How It Works

### 1. Sending Notifications (Extension Side)

The extension sends HTTP POST requests to ntfy.sh:

```javascript
fetch('https://ntfy.sh/vine-rugg-potluck', {
    method: 'POST',
    body: 'Found 3 new items on Amazon Vine!',
    headers: {
        'Title': '🛍️ Amazon Vine Alert',
        'Priority': 'default',
        'Tags': 'shopping,vine,new',
        'Actions': 'view, Open Vine, https://www.amazon.com/vine/vine-items, clear=true'
    }
})
```

### 2. Receiving Notifications (User Side)

Users can receive notifications by:
- Installing ntfy mobile app (iOS/Android)
- Using ntfy web app
- Using ntfy desktop app
- Subscribing to their unique topic

## Configuration

### Default Configuration

```javascript
{
  enabled: true,
  serverUrl: 'https://ntfy.sh',
  topic: 'vine-monitor-abc12345',  // Unique per user
  priority: 'default',
  userId: 'abc12345'
}
```

### Priority Levels

- `min` - No sound, no vibration
- `low` - No sound, no vibration
- `default` - Sound and vibration
- `high` - Sound and vibration
- `urgent` - Sound and vibration, bypasses Do Not Disturb

### Custom Server

Users can host their own ntfy server:
```javascript
{
  serverUrl: 'https://ntfy.example.com',
  topic: 'my-vine-alerts'
}
```

## User Setup Instructions

### Mobile (iOS/Android)

1. Install ntfy app from App Store or Google Play
2. Open the extension popup
3. Go to Monitoring settings
4. Scan the QR code or copy the topic name
5. Subscribe to the topic in the ntfy app
6. Enable monitoring in the extension

### Desktop

1. Visit https://ntfy.sh
2. Enter your topic name (shown in extension popup)
3. Click "Subscribe"
4. Enable browser notifications when prompted
5. Enable monitoring in the extension

### Web (No Installation)

1. Visit https://ntfy.sh/vine-monitor-abc12345 (your topic)
2. Keep the tab open
3. Enable monitoring in the extension

## API Reference

### Send Notification

```javascript
await monitoringManager.sendNtfyNotification(count, asins);
```

### Get Configuration

```javascript
const config = await monitoringManager.getNtfyConfig();
```

### Update Configuration

```javascript
await chrome.storage.local.set({
  vineNtfyConfig: {
    enabled: true,
    serverUrl: 'https://ntfy.sh',
    topic: 'my-custom-topic',
    priority: 'high'
  }
});
```

## Notification Format

### Basic Notification

```
Title: 🛍️ Amazon Vine Alert
Body: Found 3 new items on Amazon Vine!
Priority: default
Tags: shopping,vine,new
```

### With Action Button

```
Actions: view, Open Vine, https://www.amazon.com/vine/vine-items, clear=true
```

When user taps "Open Vine", it opens the URL and clears the notification.

## Privacy & Security

### What Gets Sent

- Number of new items
- Generic message text
- No personal information
- No item details or ASINs
- No Amazon credentials

### Topic Security

- Topics are randomly generated (8 characters)
- Probability of collision: ~1 in 2.8 trillion
- Users can generate new topics anytime
- Topics can be password-protected (optional)

### Data Flow

```
Extension → ntfy.sh → User's Devices
```

No data is stored permanently on ntfy.sh servers.

## Testing

### Send Test Notification

```javascript
// In browser console on Vine page
await window.vineMonitoringManager.sendNtfyNotification(1, ['test']);
```

### Check Configuration

```javascript
// In browser console
const config = await window.vineMonitoringManager.getNtfyConfig();
console.log(config);
```

## Troubleshooting

### Not Receiving Notifications

1. Check topic name matches in extension and ntfy app
2. Verify monitoring is enabled
3. Check ntfy app notification permissions
4. Try sending a test notification
5. Check browser console for errors

### Notifications Delayed

- ntfy.sh may have slight delays (usually < 1 second)
- Check your internet connection
- Verify extension is checking at expected interval

### Too Many Notifications

- Increase check interval in settings
- Adjust notification priority
- Use filters to reduce new items

## Advanced Usage

### Custom ntfy Server

Host your own ntfy server for complete control:

```bash
# Docker
docker run -p 80:80 binwiederhier/ntfy serve

# Binary
ntfy serve
```

Update extension config:
```javascript
{
  serverUrl: 'https://your-server.com',
  topic: 'vine-alerts'
}
```

### Email Notifications

ntfy can forward to email:

```javascript
headers: {
  'Email': 'your-email@example.com'
}
```

### Voice Calls

ntfy can make voice calls (requires authentication):

```javascript
headers: {
  'Call': '+1234567890',
  'Authorization': 'Bearer your-token'
}
```

## Resources

- ntfy.sh website: https://ntfy.sh
- ntfy documentation: https://docs.ntfy.sh
- ntfy GitHub: https://github.com/binwiederhier/ntfy
- Mobile apps: Search "ntfy" in App Store or Google Play

## Implementation Status

### ✅ Completed

- Core notification logic
- Integration with NewItemsManager
- Configuration management
- Error handling
- Topic generation

### 🚧 Pending

- Popup UI for ntfy settings
- QR code generation for easy mobile setup
- Test notification button
- Notification history display
- Topic regeneration feature

## Code Examples

### Complete Integration Example

```javascript
// Initialize monitoring with ntfy
const monitoring = new MonitoringManager();
monitoring.setNewItemsManager(newItemsManager);
await monitoring.setup();

// Start monitoring
await monitoring.startMonitoring();

// Listen for notifications
monitoring.on('notificationSent', (data) => {
  console.log(`Sent notification for ${data.count} items`);
});

// Configure ntfy
await chrome.storage.local.set({
  vineNtfyConfig: {
    enabled: true,
    serverUrl: 'https://ntfy.sh',
    topic: 'vine-monitor-xyz789',
    priority: 'high'
  }
});
```

## Next Steps

1. Implement popup UI for ntfy configuration
2. Add QR code generation for mobile setup
3. Create user documentation
4. Add notification history tracking
5. Implement topic regeneration
6. Add notification sound/vibration preferences

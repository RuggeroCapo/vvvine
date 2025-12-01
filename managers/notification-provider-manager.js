// Notification Provider Manager - Abstract notification system with ntfy support
// Designed to be easily extensible for Telegram and other providers

// Abstract base class for notification providers
class NotificationProvider {
  /**
   * Send a notification
   * @param {Object} notification - Notification data
   * @param {string} notification.title - Notification title
   * @param {string} notification.message - Notification body/message
   * @param {string} [notification.priority] - Priority level (min, low, default, high, urgent)
   * @param {string[]} [notification.tags] - Tags for categorization
   * @param {string} [notification.url] - URL to open when notification clicked
   * @returns {Promise<boolean>} - True if sent successfully
   */
  async send(notification) {
    throw new Error('NotificationProvider.send() must be implemented by subclass');
  }

  /**
   * Test connection to notification service
   * @returns {Promise<boolean>} - True if connection successful
   */
  async testConnection() {
    throw new Error('NotificationProvider.testConnection() must be implemented by subclass');
  }

  /**
   * Get provider name
   * @returns {string} - Provider identifier
   */
  getProviderName() {
    throw new Error('NotificationProvider.getProviderName() must be implemented by subclass');
  }
}

// ntfy.sh notification provider
class NtfyNotificationProvider extends NotificationProvider {
  constructor(config = {}) {
    super();
    this.topic = config.topic || 'vine-rugg-potluck'; // Default topic
    this.server = config.server || 'https://ntfy.sh';
    this.isConnected = false;
  }

  async send(notification) {
    try {
      const { title, message, priority = 'default', tags = [], url } = notification;

      const notificationTitle = title || 'Amazon Vine Notification';
      const notificationMessage = message || 'New items detected';
      const notificationUrl = url || window.location.href;

      // Build ntfy URL with topic
      const ntfyUrl = `${this.server}/${this.topic}`;

      // Build ntfy payload (without topic field)
      const payload = {
        message: notificationMessage,
        title: notificationTitle,
        priority: priority, // min, low, default, high, urgent
        tags: tags,
        click: notificationUrl
      };

      const response = await fetch(ntfyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ntfy HTTP ${response.status}: ${errorText}`);
      }

      await response.json();
      this.isConnected = true;
      return true;

    } catch (error) {
      console.error('❌ NtfyProvider: Failed to send notification:', error);
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
      this.isConnected = false;
      throw error;
    }
  }

  async testConnection() {
    try {
      // Send a test notification
      await this.send({
        title: 'Test Notification',
        message: 'Amazon Vine monitoring is working! 🍇',
        priority: 'low',
        tags: ['test', 'vine']
      });
      return true;
    } catch (error) {
      console.error('NtfyProvider: Connection test failed:', error);
      return false;
    }
  }

  getProviderName() {
    return 'ntfy';
  }

  getTopic() {
    return this.topic;
  }

  getServer() {
    return this.server;
  }

  getSubscribeUrl() {
    return `${this.server}/${this.topic}`;
  }
}

// Future provider placeholder - Telegram
class TelegramNotificationProvider extends NotificationProvider {
  constructor(config = {}) {
    super();
    this.botToken = config.botToken;
    this.chatId = config.chatId;
  }

  async send(notification) {
    try {
      if (!this.botToken || !this.chatId) {
        throw new Error('Telegram bot token and chat ID are required');
      }

      const { title, message, priority = 'default', tags = [], url } = notification;

      const notificationTitle = title || 'Amazon Vine Notification';
      const notificationMessage = message || 'New items detected';
      const notificationUrl = url || window.location.href;

      console.log('=== TelegramProvider: Preparing to send notification ===');
      console.log('Chat ID:', this.chatId);
      console.log('Title:', notificationTitle);
      console.log('Message:', notificationMessage);
      console.log('URL:', notificationUrl);

      // Build Telegram message with Markdown formatting
      let text = `*${notificationTitle}*\n\n${notificationMessage}`;

      // Add priority indicator (since Telegram doesn't have native priority)
      const priorityEmoji = {
        'min': '🔵',
        'low': '🟢',
        'default': '🟡',
        'high': '🟠',
        'urgent': '🔴'
      };
      const emoji = priorityEmoji[priority] || '🟡';
      text = `${emoji} ${text}`;

      const telegramUrl = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

      const payload = {
        chat_id: this.chatId,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
        reply_markup: notificationUrl ? {
          inline_keyboard: [[
            {
              text: '🔗 Open Vine',
              url: notificationUrl
            }
          ]]
        } : undefined
      };

      console.log('Payload:', JSON.stringify(payload, null, 2));

      const response = await fetch(telegramUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      console.log('Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Telegram API error:', errorData);
        throw new Error(`Telegram API error: ${errorData.description || response.statusText}`);
      }

      const responseData = await response.json();
      console.log('Response data:', responseData);
      console.log('✅ TelegramProvider: Notification sent successfully!');
      console.log('=== End notification send ===');

      return true;

    } catch (error) {
      console.error('❌ TelegramProvider: Failed to send notification:', error);
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }

  async testConnection() {
    try {
      if (!this.botToken) {
        throw new Error('Bot token is required');
      }

      // Test by calling getMe API to verify bot token
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Invalid bot token: ${errorData.description || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log('TelegramProvider: Bot verified:', data.result.username);

      // If we have a chat ID, send a test message
      if (this.chatId) {
        await this.send({
          title: 'Test Notification',
          message: 'Amazon Vine monitoring is working! 🍇',
          priority: 'low',
          tags: ['test', 'vine']
        });
      }

      return true;
    } catch (error) {
      console.error('TelegramProvider: Connection test failed:', error);
      return false;
    }
  }

  getProviderName() {
    return 'telegram';
  }
}

// Notification Provider Manager - Manages notification providers
class NotificationProviderManager extends BaseManager {
  constructor(config) {
    super(config);
    this.providers = new Map(); // provider name -> provider instance
    this.activeProvider = null;
    this.activeProviderName = 'telegram'; // Default
  }

  async setup() {
    console.log('NotificationProviderManager: setup() called');

    // Load Telegram config from storage
    const telegramConfig = await this.loadTelegramConfig();

    // Register available providers
    this.registerProvider('ntfy', new NtfyNotificationProvider({
      topic: 'vine-rugg-potluck',
      server: 'https://ntfy.sh'
    }));

    this.registerProvider('telegram', new TelegramNotificationProvider({
      botToken: telegramConfig.botToken,
      chatId: telegramConfig.chatId
    }));

    // Load active provider from storage
    await this.loadActiveProvider();

    console.log(`NotificationProviderManager: Active provider: ${this.activeProviderName}`);
  }

  async loadTelegramConfig() {
    try {
      const result = await chrome.storage.local.get(['vineTelegramConfig']);
      return result.vineTelegramConfig || {
        botToken: '',
        chatId: ''
      };
    } catch (error) {
      console.error('NotificationProviderManager: Error loading Telegram config:', error);
      return { botToken: '', chatId: '' };
    }
  }

  async saveTelegramConfig(config) {
    try {
      await chrome.storage.local.set({
        vineTelegramConfig: {
          botToken: config.botToken,
          chatId: config.chatId
        }
      });
      console.log('NotificationProviderManager: Telegram config saved');

      // Update the registered provider with new config
      this.registerProvider('telegram', new TelegramNotificationProvider({
        botToken: config.botToken,
        chatId: config.chatId
      }));

      // If telegram is active, update the active provider reference
      if (this.activeProviderName === 'telegram') {
        this.activeProvider = this.providers.get('telegram');
      }
    } catch (error) {
      console.error('NotificationProviderManager: Error saving Telegram config:', error);
      throw error;
    }
  }

  registerProvider(name, providerInstance) {
    if (!(providerInstance instanceof NotificationProvider)) {
      throw new Error('Provider must extend NotificationProvider class');
    }

    this.providers.set(name, providerInstance);
    console.log(`NotificationProviderManager: Registered provider "${name}"`);
  }

  async loadActiveProvider() {
    try {
      const result = await chrome.storage.local.get(['vineNotificationProvider']);
      const providerName = result.vineNotificationProvider || 'telegram';

      if (this.providers.has(providerName)) {
        this.activeProviderName = providerName;
        this.activeProvider = this.providers.get(providerName);
      } else {
        console.warn(`NotificationProviderManager: Provider "${providerName}" not found, using telegram`);
        this.activeProviderName = 'telegram';
        this.activeProvider = this.providers.get('telegram');
      }

      this.emit('providerLoaded', {
        providerName: this.activeProviderName
      });

    } catch (error) {
      console.error('NotificationProviderManager: Error loading provider:', error);
      // Fallback to telegram
      this.activeProviderName = 'telegram';
      this.activeProvider = this.providers.get('telegram');
    }
  }

  async setActiveProvider(providerName) {
    if (!this.providers.has(providerName)) {
      throw new Error(`Provider "${providerName}" not registered`);
    }

    this.activeProviderName = providerName;
    this.activeProvider = this.providers.get(providerName);

    await chrome.storage.local.set({
      vineNotificationProvider: providerName
    });

    this.emit('providerChanged', {
      providerName: providerName
    });

    console.log(`NotificationProviderManager: Switched to provider "${providerName}"`);
  }

  /**
   * Send a notification using the active provider
   * @param {Object} notification - Notification data
   * @returns {Promise<boolean>} - True if sent successfully
   */
  async sendNotification(notification) {
    if (!this.activeProvider) {
      throw new Error('No active notification provider');
    }

    try {
      const success = await this.activeProvider.send(notification);

      this.emit('notificationSent', {
        provider: this.activeProviderName,
        notification: notification
      });

      return success;

    } catch (error) {
      this.emit('notificationFailed', {
        provider: this.activeProviderName,
        notification: notification,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Test connection to active provider
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    if (!this.activeProvider) {
      throw new Error('No active notification provider');
    }

    return await this.activeProvider.testConnection();
  }

  getActiveProviderName() {
    return this.activeProviderName;
  }

  getActiveProvider() {
    return this.activeProvider;
  }

  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  isProviderAvailable(providerName) {
    return this.providers.has(providerName);
  }

  cleanup() {
    super.cleanup();
    console.log('NotificationProviderManager: cleanup() called');
  }
}

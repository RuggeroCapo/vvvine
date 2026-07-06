// Notification Provider Manager - Abstract notification system
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

// Telegram notification provider
class TelegramNotificationProvider extends NotificationProvider {
  constructor(config = {}) {
    super();
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.maxMessageLength = 4096;
  }

  static escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  static escapeHtmlAttribute(text) {
    return TelegramNotificationProvider.escapeHtml(text).replace(/"/g, '&quot;');
  }

  static cleanItemTitle(title) {
    const cleaned = (title || 'Unknown item').replace(/…+$/g, '').trim();
    return cleaned || 'Unknown item';
  }

  getProductUrl(item) {
    if (item?.url) {
      return item.url;
    }

    const match = window.location?.href?.match(/(https:\/\/www\.amazon\.[^/]+)/);
    const origin = match ? match[1] : 'https://www.amazon.it';
    return item?.asin ? `${origin}/dp/${item.asin}` : '';
  }

  getQueueLabel(queue) {
    switch (queue) {
      case 'potluck':
        return 'Potluck';
      case 'encore':
        return 'Encore';
      case 'last_chance':
        return 'Last Chance';
      case 'search':
        return 'Search';
      default:
        return queue || 'Unknown';
    }
  }

  formatItemBlockHtml(item, index) {
    const asin = TelegramNotificationProvider.escapeHtml(item.asin || '—');
    const title = TelegramNotificationProvider.escapeHtml(
      TelegramNotificationProvider.cleanItemTitle(item.title)
    );
    const productUrl = this.getProductUrl(item);
    const link = productUrl
      ? `\n<a href="${TelegramNotificationProvider.escapeHtmlAttribute(productUrl)}">Open product</a>`
      : '';

    return `<b>${index + 1}.</b> <code>${asin}</code>\n${title}${link}`;
  }

  buildItemSectionsHtml(notification) {
    const { items = [], itemsByQueue = null } = notification;
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (itemsByQueue) {
      const sections = [];
      let itemIndex = 0;

      for (const queue of Object.keys(itemsByQueue)) {
        const queueItems = itemsByQueue[queue];
        const queueLabel = TelegramNotificationProvider.escapeHtml(this.getQueueLabel(queue));
        let section = `<b>${queueLabel}</b> (${queueItems.length}):\n`;

        for (const item of queueItems) {
          section += `${this.formatItemBlockHtml(item, itemIndex)}\n\n`;
          itemIndex++;
        }

        sections.push(section.trimEnd());
      }

      return sections;
    }

    return [items.map((item, index) => this.formatItemBlockHtml(item, index)).join('\n\n')];
  }

  buildTelegramMessages(notification) {
    const { title, message, priority = 'default', url, items = [] } = notification;
    const notificationTitle = title || 'Amazon Vine Notification';
    const notificationMessage = message || 'New items detected';
    const notificationUrl = url || window.location?.href || '';

    const priorityEmoji = {
      min: '🔵',
      low: '🟢',
      default: '🟡',
      high: '🟠',
      urgent: '🔴'
    };
    const emoji = priorityEmoji[priority] || '🟡';
    const header = `${emoji} <b>${TelegramNotificationProvider.escapeHtml(notificationTitle)}</b>`;

    const itemSections = this.buildItemSectionsHtml(notification);
    if (itemSections.length === 0) {
      return [{
        text: `${header}\n\n${TelegramNotificationProvider.escapeHtml(notificationMessage)}`,
        url: notificationUrl
      }];
    }

    const summaryEnd = notificationMessage.indexOf('\n\n');
    const summary = summaryEnd >= 0 ? notificationMessage.slice(0, summaryEnd) : '';
    const summaryHtml = summary
      ? `${TelegramNotificationProvider.escapeHtml(summary)}\n\n`
      : '';
    const messages = [];
    const reserveLength = 120;
    let currentText = `${header}\n\n${summaryHtml}`;
    let partNumber = 1;

    const pushCurrentMessage = () => {
      if (currentText.trim()) {
        messages.push({ text: currentText.trimEnd(), url: notificationUrl, partNumber });
        partNumber++;
      }
      currentText = partNumber > 1 ? `${header} <i>(continued)</i>\n\n` : `${header}\n\n${summaryHtml}`;
    };

    for (const section of itemSections) {
      const sectionWithSpacing = `${section}\n\n`;
      if ((currentText + sectionWithSpacing).length > this.maxMessageLength - reserveLength) {
        const initialText = `${header}\n\n${summaryHtml}`.trim();
        const continuedHeader = `${header} <i>(continued)</i>\n\n`;
        if (currentText.trim() !== initialText && currentText.trim() !== continuedHeader.trim()) {
          pushCurrentMessage();
        }

        if (section.length > this.maxMessageLength - reserveLength) {
          const blocks = section.split('\n\n');
          for (const block of blocks) {
            const blockWithSpacing = `${block}\n\n`;
            if ((currentText + blockWithSpacing).length > this.maxMessageLength - reserveLength) {
              pushCurrentMessage();
            }
            currentText += blockWithSpacing;
          }
        } else {
          currentText += sectionWithSpacing;
        }
      } else {
        currentText += sectionWithSpacing;
      }
    }

    pushCurrentMessage();

    if (messages.length > 1) {
      const totalParts = messages.length;
      messages.forEach((entry, index) => {
        entry.text = `${entry.text}\n\n<i>Part ${index + 1}/${totalParts}</i>`;
      });
    }

    return messages;
  }

  async postTelegramMessage(text, notificationUrl) {
    const telegramUrl = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const payload = {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: notificationUrl ? {
        inline_keyboard: [[
          {
            text: '🔗 Open Vine',
            url: notificationUrl
          }
        ]]
      } : undefined
    };

    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Telegram API error:', errorData);
      throw new Error(`Telegram API error: ${errorData.description || response.statusText}`);
    }

    return response.json();
  }

  async send(notification) {
    try {
      if (!this.botToken || !this.chatId) {
        throw new Error('Telegram bot token and chat ID are required');
      }

      const { title, message, url } = notification;
      const notificationTitle = title || 'Amazon Vine Notification';
      const notificationMessage = message || 'New items detected';
      const notificationUrl = url || window.location.href;

      console.log('=== TelegramProvider: Preparing to send notification ===');
      console.log('Chat ID:', this.chatId);
      console.log('Title:', notificationTitle);
      console.log('Message length:', notificationMessage.length);
      console.log('Items:', notification.items?.length || 0);
      console.log('URL:', notificationUrl);

      const messages = this.buildTelegramMessages(notification);

      for (const entry of messages) {
        console.log('Sending Telegram part:', entry.partNumber || 1, 'length:', entry.text.length);
        await this.postTelegramMessage(entry.text, entry.url || notificationUrl);
      }

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

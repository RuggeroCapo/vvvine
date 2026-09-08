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

  static decodeHtmlEntities(text) {
    if (!text || !/[&][#a-zA-Z0-9]+;/.test(text)) {
      return text;
    }

    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  static cleanItemTitle(title) {
    const decoded = TelegramNotificationProvider.decodeHtmlEntities(title || '');
    const cleaned = decoded.replace(/…+$/g, '').trim();
    return cleaned || 'Unknown item';
  }

  static getAffinitySourceLabel(source) {
    switch (source) {
      case 'rule':
        return 'rules';
      case 'llm':
        return 'AI';
      case 'veto':
        return 'veto';
      default:
        return '';
    }
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

  getAffinityMeta(item) {
    const autopick = item?.autopick;
    if (autopick?.affinityScore != null) {
      return {
        affinityScore: autopick.affinityScore,
        confidence: autopick.confidence,
        affinitySource: autopick.affinitySource
      };
    }

    const quickScore = window.vineAutopickManager?.getQuickNotificationScore?.(item);
    if (quickScore?.affinityScore != null) {
      return {
        affinityScore: quickScore.affinityScore,
        confidence: quickScore.confidence,
        affinitySource: quickScore.affinitySource
      };
    }

    return null;
  }

  formatItemMetaLine(item, options = {}) {
    const { showQueue = true } = options;
    const metaParts = [];

    if (showQueue) {
      metaParts.push(TelegramNotificationProvider.escapeHtml(this.getQueueLabel(item.queue)));
    }

    const affinity = this.getAffinityMeta(item);
    if (affinity?.affinityScore != null) {
      const sourceLabel = TelegramNotificationProvider.getAffinitySourceLabel(affinity.affinitySource);
      const affinityText = sourceLabel
        ? `Affinity ${affinity.affinityScore}/10 (${sourceLabel})`
        : `Affinity ${affinity.affinityScore}/10`;
      metaParts.push(TelegramNotificationProvider.escapeHtml(affinityText));
    }

    if (affinity?.confidence != null) {
      metaParts.push(TelegramNotificationProvider.escapeHtml(`${affinity.confidence}% match`));
    }

    return metaParts.length > 0 ? `<i>${metaParts.join(' · ')}</i>` : '';
  }

  formatItemBlockHtml(item, options = {}) {
    const { showQueue = true, index = null, includeTitle = true } = options;
    const title = TelegramNotificationProvider.escapeHtml(
      TelegramNotificationProvider.cleanItemTitle(item.title)
    );
    const asin = TelegramNotificationProvider.escapeHtml(item.asin || '—');
    const productUrl = this.getProductUrl(item);
    const indexPrefix = index != null ? `${index}. ` : '';
    const metaLine = this.formatItemMetaLine(item, { showQueue });

    let block = '';
    if (includeTitle) {
      block = `<b>${indexPrefix}${title}</b>`;
      if (metaLine) {
        block += `\n${metaLine}`;
      }
    } else if (metaLine) {
      block = metaLine;
    }
    block += `\n<code>${asin}</code>`;

    if (productUrl) {
      block += `\n<a href="${TelegramNotificationProvider.escapeHtmlAttribute(productUrl)}">View on Amazon</a>`;
    }

    return block;
  }

  buildItemSectionsHtml(notification) {
    const { items = [], itemsByQueue = null } = notification;
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (items.length === 1) {
      return [this.formatItemBlockHtml(items[0], { showQueue: true, includeTitle: false })];
    }

    if (itemsByQueue) {
      const queueKeys = Object.keys(itemsByQueue);
      const singleQueue = queueKeys.length === 1;
      const sections = [];
      let itemIndex = 0;

      for (const queue of queueKeys) {
        const queueItems = itemsByQueue[queue];
        let section = '';

        if (!singleQueue) {
          const queueLabel = TelegramNotificationProvider.escapeHtml(this.getQueueLabel(queue));
          section += `<b>${queueLabel}</b> (${queueItems.length})\n`;
        }

        const blocks = queueItems.map((item) => {
          itemIndex += 1;
          return this.formatItemBlockHtml(item, {
            showQueue: singleQueue,
            index: itemIndex
          });
        });

        section += blocks.join('\n\n');
        sections.push(section.trimEnd());
      }

      return sections;
    }

    return [items.map((item, index) => this.formatItemBlockHtml(item, {
      showQueue: true,
      index: index + 1
    })).join('\n\n')];
  }

  buildNotificationHeader(notification, emoji) {
    const { items = [], itemsByQueue = null } = notification;
    const count = items.length;

    if (count === 1) {
      const title = TelegramNotificationProvider.cleanItemTitle(items[0].title);
      const headerTitle = title.length > 140 ? `${title.slice(0, 137)}…` : title;
      return `${emoji} <b>${TelegramNotificationProvider.escapeHtml(headerTitle)}</b>`;
    }

    const queueKeys = itemsByQueue ? Object.keys(itemsByQueue) : [];
    const sharedQueue = queueKeys.length === 1
      ? ` · ${TelegramNotificationProvider.escapeHtml(this.getQueueLabel(queueKeys[0]))}`
      : '';

    return `${emoji} <b>${count} New Vine Items${sharedQueue}</b>`;
  }

  buildTelegramMessages(notification) {
    const { message, priority = 'default', url, items = [] } = notification;
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

    const itemSections = this.buildItemSectionsHtml(notification);
    if (itemSections.length === 0) {
      const fallbackHeader = `${emoji} <b>${TelegramNotificationProvider.escapeHtml(notification.title || 'Amazon Vine Notification')}</b>`;
      return [{
        text: `${fallbackHeader}\n\n${TelegramNotificationProvider.escapeHtml(notificationMessage)}`,
        url: notificationUrl
      }];
    }

    const header = this.buildNotificationHeader(notification, emoji);
    const messages = [];
    const reserveLength = 120;
    let currentText = `${header}\n\n`;
    let partNumber = 1;

    const pushCurrentMessage = () => {
      if (currentText.trim()) {
        messages.push({ text: currentText.trimEnd(), url: notificationUrl, partNumber });
        partNumber++;
      }
      currentText = partNumber > 1 ? `${header} <i>(continued)</i>\n\n` : `${header}\n\n`;
    };

    for (const section of itemSections) {
      const sectionWithSpacing = `${section}\n\n`;
      if ((currentText + sectionWithSpacing).length > this.maxMessageLength - reserveLength) {
        const initialText = `${header}\n\n`.trim();
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

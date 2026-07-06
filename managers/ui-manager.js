// UI Manager - Handles control panel interface and UI interactions
class UIManager extends BaseManager {
  constructor(config) {
    super(config);
    this.controlPanel = null;
    this.currentPage = this.getCurrentPageNumber();
    this.lastPollHealth = {};
  }

  async setup() {
    console.log('[Vine Enhancer] UIManager setup starting...');

    // Wait for the tab content (exists even without products)
    try {
      await this.waitForElement('.vvp-tab-content');
      console.log('[Vine Enhancer] .vvp-tab-content found');
    } catch (error) {
      console.error('[Vine Enhancer] Failed to find .vvp-tab-content:', error);
      return;
    }

    this.createControlPanel();
    this.setupControlListeners();
    this.setupStatusUpdates();
    console.log('[Vine Enhancer] UIManager setup complete');
  }

  getCurrentPageNumber() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('page')) || 1;
  }

  createControlPanel() {
    this.controlPanel = document.createElement('div');
    this.controlPanel.id = 'vine-enhancer-panel';
    this.controlPanel.innerHTML = `
      <div class="vine-controls">
        <div class="vine-control-group vine-control-group-actions">
          <button id="mark-all-seen" title="Mark All as Seen">
            <span class="vine-btn-icon">👁️</span>
            <span class="vine-btn-text">Mark All</span>
          </button>
          <button id="clear-seen" title="Clear All Seen Items">
            <span class="vine-btn-icon">🗑️</span>
            <span class="vine-btn-text">Clear Seen</span>
          </button>
        </div>

        <div class="vine-control-separator"></div>

        <div class="vine-control-group vine-control-group-toggles">
          <div class="vine-slider-container">
            <span class="vine-slider-label">Show Seen</span>
            <label class="vine-slider">
              <input type="checkbox" id="show-seen-slider" title="Toggle visibility of seen items">
              <span class="vine-slider-toggle"></span>
            </label>
          </div>
        </div>

        <div class="vine-control-separator"></div>

        <div class="vine-control-group vine-control-group-monitoring">
          <button id="monitoring-toggle" class="vine-btn-monitoring-off" title="Start/Stop Monitoring">
            <span class="vine-btn-icon">▶️</span>
            <span class="vine-btn-text">Monitor</span>
          </button>
          <button id="monitoring-refresh" title="Refresh Now">
            <span class="vine-btn-icon">🔄</span>
          </button>
          <button id="monitoring-settings" title="Monitoring Settings">
            <span class="vine-btn-icon">⚙️</span>
          </button>
        </div>

        <div class="vine-control-separator"></div>

        <div class="vine-control-group vine-control-group-view">
          <button id="toggle-view" title="Toggle Card/Table View">
            <span class="vine-btn-icon">📊</span>
            <span class="vine-btn-text">Table</span>
          </button>
          <button id="toggle-bookmarks" title="Toggle Bookmarks Sidebar">
            <span class="vine-btn-icon">📚</span>
            <span class="vine-btn-text">Bookmarks</span>
          </button>
        </div>

        <div class="vine-control-separator"></div>

        <div class="vine-control-group vine-control-group-filter">
          <input type="text" id="filter-input" placeholder="🔍 Filter products..." title="Filter current page">
        </div>

        <div class="vine-control-group vine-control-group-status">
          <span id="status-info">Page ${this.currentPage} | Loading...</span>
        </div>
      </div>

      <!-- Monitoring Settings Panel (collapsible) -->
      <div id="monitoring-settings-panel" class="vine-monitoring-panel" style="display: none;">
        <div class="vine-monitoring-panel-content">
          <div class="vine-monitoring-section">
            <span class="vine-monitoring-label">Queue:</span>
            <span id="monitoring-queue-display" class="vine-monitoring-queue-badge">Current Queue</span>
          </div>
          <div class="vine-monitoring-section">
            <span class="vine-monitoring-label">Mode:</span>
            <div class="vine-monitoring-mode-toggle">
              <button class="vine-monitoring-mode-btn vine-monitoring-mode-active" data-monitoring-mode="polling">Polling</button>
              <button class="vine-monitoring-mode-btn" data-monitoring-mode="live">Live</button>
            </div>
            <span id="monitoring-live-state" class="vine-monitoring-live-state vine-monitoring-live-idle">Idle</span>
            <span id="monitoring-poll-health" class="vine-monitoring-live-state vine-monitoring-live-idle" style="display: none;">Idle</span>
          </div>
          <div id="monitoring-refresh-section" class="vine-monitoring-section">
            <span class="vine-monitoring-label">Refresh:</span>
            <div class="vine-monitoring-presets">
              <button class="vine-preset-btn" data-seconds="30">30s</button>
              <button class="vine-preset-btn" data-seconds="60">1m</button>
              <button class="vine-preset-btn" data-seconds="120">2m</button>
              <button class="vine-preset-btn vine-preset-active" data-seconds="300">5m</button>
              <button class="vine-preset-btn" data-seconds="600">10m</button>
            </div>
            <div class="vine-monitoring-custom">
              <input type="number" id="monitoring-interval-input" min="10" max="1800" value="300" class="vine-interval-input">
              <span class="vine-interval-unit">sec</span>
            </div>
          </div>
          <div id="monitoring-live-section" class="vine-monitoring-section" style="display: none;">
            <span class="vine-monitoring-label">Live:</span>
            <input
              type="text"
              id="monitoring-live-url-input"
              class="vine-monitoring-live-input"
              placeholder="https://ita-vine-stats.duckdns.org/api/live"
              value="${this.getDefaultLiveUrl()}"
              autocomplete="off"
              spellcheck="false"
            >
          </div>
        </div>
      </div>
    `;

    // Insert control panel after the button/search container (always present)
    const buttonSearchContainer = document.querySelector('.vvp-items-button-and-search-container');
    console.log('[Vine Enhancer] Button/search container found:', buttonSearchContainer);
    if (buttonSearchContainer) {
      buttonSearchContainer.parentNode.insertBefore(this.controlPanel, buttonSearchContainer.nextSibling);
      console.log('[Vine Enhancer] Control panel inserted successfully');
    } else {
      console.error('[Vine Enhancer] Could not find .vvp-items-button-and-search-container');
    }

    // Add CSS for the slider
    this.addSliderStyles();

    // Initialize view mode
    this.currentView = 'card'; // 'card' or 'table'

    // Set initial view state on body
    document.body.setAttribute('data-vine-view', 'card');
  }

  addSliderStyles() {
    if (document.getElementById('vine-slider-styles')) return;

    const style = document.createElement('style');
    style.id = 'vine-slider-styles';
    style.textContent = `
      .vine-slider-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .vine-slider-label {
        font-size: 12px;
        font-weight: 500;
        color: #333;
      }
      
      .vine-slider {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
      }
      
      .vine-slider input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      
      .vine-slider-toggle {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #ccc;
        transition: .4s;
        border-radius: 24px;
      }
      
      .vine-slider-toggle:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .4s;
        border-radius: 50%;
      }
      
      .vine-slider input:checked + .vine-slider-toggle {
        background-color: #4CAF50;
      }
      
      .vine-slider input:checked + .vine-slider-toggle:before {
        transform: translateX(20px);
      }
      
      .vine-slider-toggle:hover {
        box-shadow: 0 0 1px #4CAF50;
      }
    `;
    document.head.appendChild(style);
  }

  getDefaultLiveUrl() {
    return window.VINE_DEFAULT_LIVE_URL || '';
  }

  setupControlListeners() {
    // Mark all seen
    document.getElementById('mark-all-seen').addEventListener('click', () => {
      this.emit('markAllSeen');
    });

    // Show/hide seen slider
    document.getElementById('show-seen-slider').addEventListener('change', (e) => {
      this.emit('setSeenVisibility', { visible: e.target.checked });
    });

    // Clear seen items
    document.getElementById('clear-seen').addEventListener('click', () => {
      if (confirm('Clear all seen items? This cannot be undone.')) {
        this.emit('clearAllSeen');
      }
    });

    // Toggle bookmarks sidebar
    document.getElementById('toggle-bookmarks').addEventListener('click', () => {
      this.emit('toggleBookmarkSidebar');
    });

    // Toggle view mode
    document.getElementById('toggle-view').addEventListener('click', () => {
      this.toggleView();
    });

    // Filter input
    const filterInput = document.getElementById('filter-input');
    filterInput.addEventListener('input', (e) => {
      this.emit('filterItems', { query: e.target.value });
    });

    // Clear filter on Escape
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.target.value = '';
        this.emit('filterItems', { query: '' });
      }
    });

    // Emit initial slider state to synchronize seen items manager
    this.syncSliderState();

    // Setup monitoring controls
    this.setupMonitoringControls();
  }

  setupMonitoringControls() {
    console.log('[UIManager] Setting up monitoring controls');

    // Toggle monitoring button
    const monitoringToggle = document.getElementById('monitoring-toggle');
    if (!monitoringToggle) {
      console.error('[UIManager] monitoring-toggle button not found!');
      return;
    }

    monitoringToggle.addEventListener('click', () => {
      console.log('[UIManager] Monitor button clicked');
      this.toggleMonitoring();
    });
    console.log('[UIManager] Monitor button listener attached');

    // Refresh button
    const refreshBtn = document.getElementById('monitoring-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.disabled = true;
        refreshBtn.querySelector('.vine-btn-icon').classList.add('vine-spinning');
        this.emit('manualRefresh');
      });
      this.on('manualRefreshComplete', () => {
        refreshBtn.disabled = false;
        refreshBtn.querySelector('.vine-btn-icon').classList.remove('vine-spinning');
      });
    }

    // Settings button to show/hide panel
    const settingsBtn = document.getElementById('monitoring-settings');
    const settingsPanel = document.getElementById('monitoring-settings-panel');
    if (settingsBtn && settingsPanel) {
      settingsBtn.addEventListener('click', () => {
        const isVisible = settingsPanel.style.display !== 'none';
        settingsPanel.style.display = isVisible ? 'none' : 'block';
        console.log('[UIManager] Settings panel toggled:', !isVisible);
      });
    }

    // Preset buttons
    const presetBtns = document.querySelectorAll('.vine-preset-btn');
    const intervalInput = document.getElementById('monitoring-interval-input');
    const modeButtons = document.querySelectorAll('[data-monitoring-mode]');

    presetBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const seconds = parseInt(btn.dataset.seconds);
        if (intervalInput) intervalInput.value = seconds;
        this.highlightPreset(seconds);
      });
    });

    // Custom number input clears preset highlight when value doesn't match
    if (intervalInput) {
      intervalInput.addEventListener('input', () => {
        const val = parseInt(intervalInput.value);
        this.highlightPreset(val);
      });
    }

    modeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.setMonitoringMode(btn.dataset.monitoringMode);
      });
    });

    // Update queue display based on current page
    this.updateQueueDisplay();

    // Listen for monitoring state changes from MonitoringManager
    console.log('[UIManager] Setting up monitoringStateChanged listener');
    this.on('monitoringStateChanged', (data) => {
      console.log('[UIManager] Received monitoringStateChanged event:', data);
      this.updateMonitoringUI(data.isMonitoring, data.config);
    });

    this.on('monitoringLiveStateChanged', (data) => {
      this.updateLiveState(data?.state, data);
    });

    this.on('monitoringHealthChanged', (health) => {
      this.lastPollHealth = health || {};
      this.updatePollHealthState(this.lastPollHealth);
    });

    // Sync UI with persisted monitoring state (handles case where
    // MonitoringManager emitted the event before UIManager was ready)
    const monitoringEnabled = sessionStorage.getItem('vineMonitoringEnabled') === 'true';
    if (monitoringEnabled) {
      try {
        const configStr = sessionStorage.getItem('vineMonitoringConfig');
        const config = configStr ? JSON.parse(configStr) : {};
        this.updateMonitoringUI(true, config);
      } catch (e) {
        this.updateMonitoringUI(true, {});
      }
    } else {
      try {
        const configStr = sessionStorage.getItem('vineMonitoringConfig');
        const config = configStr ? JSON.parse(configStr) : {};
        this.updateMonitoringConfigUI(config);
      } catch (e) {
        this.updateMonitoringConfigUI({});
      }
    }
  }

  highlightPreset(seconds) {
    const presetBtns = document.querySelectorAll('.vine-preset-btn');
    presetBtns.forEach(btn => {
      const btnSeconds = parseInt(btn.dataset.seconds);
      btn.classList.toggle('vine-preset-active', btnSeconds === seconds);
    });
  }

  getCurrentQueue() {
    // Get queue from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const queue = urlParams.get('queue');
    if (queue) {
      return queue;
    }
    // Default to potluck if no queue parameter
    return 'potluck';
  }

  getQueueLabel(queue) {
    switch (queue) {
      case 'potluck':
        return 'Potluck';
      case 'encore':
        return 'Encore';
      case 'last_chance':
        return 'Last Chance';
      default:
        return queue || 'Unknown';
    }
  }

  updateQueueDisplay() {
    const queueDisplay = document.getElementById('monitoring-queue-display');
    if (queueDisplay) {
      const queue = this.getCurrentQueue();
      queueDisplay.textContent = this.getQueueLabel(queue);
    }
  }

  formatInterval(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}min`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
  }

  toggleMonitoring() {
    console.log('[UIManager] toggleMonitoring called');
    const monitoringToggle = document.getElementById('monitoring-toggle');
    const isCurrentlyMonitoring = monitoringToggle.classList.contains('vine-btn-monitoring-on');
    console.log('[UIManager] Current monitoring state:', isCurrentlyMonitoring);

    if (isCurrentlyMonitoring) {
      // Stop monitoring
      console.log('[UIManager] Emitting stopMonitoring event');
      this.emit('stopMonitoring');
    } else {
      // Start monitoring with current config
      const config = this.getMonitoringConfig();
      console.log('[UIManager] Monitoring config:', config);
      if (!config) {
        console.error('[UIManager] Failed to get monitoring config');
        return; // Validation failed
      }
      console.log('[UIManager] Emitting startMonitoring event with config:', config);
      this.emit('startMonitoring', config);
    }
  }

  getMonitoringConfig() {
    console.log('[UIManager] getMonitoringConfig called');

    // Get current queue from URL
    const currentQueue = this.getCurrentQueue();
    console.log('[UIManager] Current queue:', currentQueue);

    // Get refresh interval
    const intervalElement = document.getElementById('monitoring-interval-input');
    if (!intervalElement) {
      console.error('[UIManager] monitoring-interval-input element not found!');
      alert('Error: Cannot find monitoring interval setting. Please refresh the page.');
      return null;
    }

    const refreshIntervalSeconds = parseInt(intervalElement.value) || 300;
    console.log('[UIManager] Refresh interval:', refreshIntervalSeconds);
    const selectedMode = document.querySelector('.vine-monitoring-mode-btn.vine-monitoring-mode-active')?.dataset.monitoringMode || 'polling';
    const liveUrl = document.getElementById('monitoring-live-url-input')?.value?.trim() || '';

    const config = {
      queues: [currentQueue],
      refreshIntervalSeconds,
      searchQuery: '',
      transportMode: selectedMode,
      liveUrl
    };

    if (selectedMode === 'live' && !liveUrl) {
      alert('Please enter a live stream URL before starting live monitoring.');
      return null;
    }

    console.log('[UIManager] Final config:', config);
    return config;
  }

  updateMonitoringUI(isMonitoring, config) {
    console.log('[UIManager] updateMonitoringUI called:', { isMonitoring, config });

    const monitoringToggle = document.getElementById('monitoring-toggle');
    if (!monitoringToggle) {
      console.error('[UIManager] monitoring-toggle button not found!');
      return;
    }

    const icon = monitoringToggle.querySelector('.vine-btn-icon');
    const text = monitoringToggle.querySelector('.vine-btn-text');

    if (!icon || !text) {
      console.error('[UIManager] Button icon or text not found!');
      return;
    }

    if (isMonitoring) {
      console.log('[UIManager] Setting UI to monitoring state');
      monitoringToggle.classList.remove('vine-btn-monitoring-off');
      monitoringToggle.classList.add('vine-btn-monitoring-on');
      icon.textContent = '⏸️';
      text.textContent = 'Stop';
    } else {
      console.log('[UIManager] Setting UI to stopped state');
      monitoringToggle.classList.remove('vine-btn-monitoring-on');
      monitoringToggle.classList.add('vine-btn-monitoring-off');
      icon.textContent = '▶️';
      text.textContent = 'Monitor';
    }

    // Update config UI if provided
    if (config) {
      console.log('[UIManager] Updating config UI');
      this.updateMonitoringConfigUI(config);
    }
  }

  updateMonitoringConfigUI(config) {
    // Update queue display
    this.updateQueueDisplay();

    const transportMode = config.transportMode === 'live' ? 'live' : 'polling';
    this.setMonitoringMode(transportMode, false);

    // Update interval input and highlight matching preset
    const intervalInput = document.getElementById('monitoring-interval-input');
    if (intervalInput && config.refreshIntervalSeconds) {
      intervalInput.value = config.refreshIntervalSeconds;
      this.highlightPreset(config.refreshIntervalSeconds);
    }

    const liveInput = document.getElementById('monitoring-live-url-input');
    if (liveInput) {
      liveInput.value = config.liveUrl || this.getDefaultLiveUrl();
    }
  }

  setMonitoringMode(mode, updateState = true) {
    const normalizedMode = mode === 'live' ? 'live' : 'polling';
    const modeButtons = document.querySelectorAll('[data-monitoring-mode]');

    modeButtons.forEach(btn => {
      btn.classList.toggle('vine-monitoring-mode-active', btn.dataset.monitoringMode === normalizedMode);
    });

    const refreshSection = document.getElementById('monitoring-refresh-section');
    const liveSection = document.getElementById('monitoring-live-section');

    if (refreshSection) {
      refreshSection.style.display = normalizedMode === 'live' ? 'none' : 'flex';
    }

    if (liveSection) {
      liveSection.style.display = normalizedMode === 'live' ? 'flex' : 'none';
    }

    const liveStateEl = document.getElementById('monitoring-live-state');
    const pollHealthEl = document.getElementById('monitoring-poll-health');
    if (liveStateEl) {
      liveStateEl.style.display = normalizedMode === 'live' ? '' : 'none';
    }
    if (pollHealthEl) {
      pollHealthEl.style.display = normalizedMode === 'live' ? 'none' : '';
    }

    if (updateState) {
      if (normalizedMode === 'live') {
        this.updateLiveState('idle');
      } else {
        this.updatePollHealthState(this.lastPollHealth || {});
      }
    }
  }

  updatePollHealthState(health = {}) {
    const pollHealth = document.getElementById('monitoring-poll-health');
    if (!pollHealth) return;

    const { isChecking, consecutiveFailures = 0, lastFailureReason, lastSuccessTime, lastCheckTime } = health;

    let state = 'idle';
    let label = 'Idle';

    if (isChecking) {
      state = 'connecting';
      label = 'Checking…';
    } else if (consecutiveFailures > 0) {
      state = lastFailureReason === 'session-expired' ? 'error' : 'reconnecting';
      label = lastFailureReason === 'session-expired' ? 'Signed out' : `Failing (${consecutiveFailures})`;
    } else if (lastSuccessTime) {
      state = 'connected';
      label = 'OK';
    }

    pollHealth.textContent = label;
    pollHealth.className = 'vine-monitoring-live-state';
    pollHealth.classList.add(`vine-monitoring-live-${state}`);

    const titleParts = [];
    if (lastCheckTime) titleParts.push(`Last check: ${new Date(lastCheckTime).toLocaleTimeString()}`);
    if (lastSuccessTime) titleParts.push(`Last success: ${new Date(lastSuccessTime).toLocaleTimeString()}`);
    if (lastFailureReason) titleParts.push(`Last failure: ${lastFailureReason}`);
    pollHealth.title = titleParts.length ? titleParts.join(' | ') : 'No checks yet';
  }

  updateLiveState(state, data = {}) {
    const liveState = document.getElementById('monitoring-live-state');
    if (!liveState) return;

    const normalizedState = state || 'idle';
    const labelMap = {
      hidden: 'Polling',
      idle: 'Idle',
      connecting: 'Connecting',
      connected: 'Connected',
      reconnecting: 'Reconnecting',
      disconnected: 'Disconnected',
      error: 'Error'
    };

    liveState.textContent = labelMap[normalizedState] || 'Idle';
    liveState.className = 'vine-monitoring-live-state';

    if (normalizedState !== 'hidden') {
      liveState.classList.add(`vine-monitoring-live-${normalizedState.replace(/_/g, '-')}`);
    }

    if (data.message) {
      liveState.title = data.message;
    } else if (data.code) {
      liveState.title = `Live state: ${normalizedState} (${data.code})`;
    } else {
      liveState.title = `Live state: ${normalizedState}`;
    }
  }

  syncSliderState() {
    const slider = document.getElementById('show-seen-slider');
    if (slider) {
      // Emit the initial state to synchronize with seen items manager
      this.emit('setSeenVisibility', { visible: slider.checked });
    }
  }

  // Get current slider state
  getSeenVisibilityState() {
    const slider = document.getElementById('show-seen-slider');
    return slider ? slider.checked : false;
  }

  // Set slider state programmatically
  setSliderState(visible) {
    const slider = document.getElementById('show-seen-slider');
    if (slider && slider.checked !== visible) {
      slider.checked = visible;
      this.emit('setSeenVisibility', { visible: visible });
    }
  }

  setupStatusUpdates() {
    // Listen for status updates from other managers
    this.on('seenItemsLoaded', (data) => {
      this.updateStatusInfo();
    });

    this.on('itemMarkedSeen', (data) => {
      this.updateStatusInfo();
    });

    this.on('itemMarkedUnseen', (data) => {
      this.updateStatusInfo();
    });

    this.on('multipleItemsMarkedSeen', (data) => {
      this.updateStatusInfo();
    });

    this.on('allSeenItemsCleared', (data) => {
      this.updateStatusInfo();
    });

    // Listen for new items updates
    this.on('newItemsStatsUpdated', (data) => {
      this.updateStatusInfo();
    });

    this.on('newItemsDetected', (data) => {
      this.updateStatusInfo();
    });

    this.on('filterLoaded', (data) => {
      this.restoreFilterInput(data.query);
    });

    this.on('itemsFiltered', (data) => {
      this.updateStatusInfo();
    });

    this.on('autopick:scored', () => {
      if (this.currentView === 'table') {
        this.showTableView();
      }
    });

    // Listen for table row visibility updates
    this.on('updateTableRowVisibility', (data) => {
      this.updateTableRow(data.itemId, { visible: data.visible });
    });
  }

  updateStatusInfo() {
    const statusElement = document.getElementById('status-info');
    if (!statusElement) return;

    const seenCount = this.getCurrentSeenCount();
    const newCount = this.getCurrentNewItemsCount();
    const visibleCount = this.getCurrentVisibleCount();

    statusElement.textContent = `Page ${this.currentPage} | ${seenCount} seen | ${newCount} NEW | ${visibleCount} visible`;
  }

  getCurrentSeenCount() {
    return document.querySelectorAll('.vine-seen').length;
  }

  getCurrentNewItemsCount() {
    return document.querySelectorAll('.vine-new-item').length;
  }

  getCurrentVisibleCount() {
    return document.querySelectorAll('.vvp-item-tile:not([style*="display: none"])').length;
  }

  // UI utility methods
  showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `vine-notification vine-notification-${type}`;
    notification.textContent = message;

    // Style the notification
    Object.assign(notification.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '10px 15px',
      backgroundColor: type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#2196f3',
      color: 'white',
      borderRadius: '4px',
      zIndex: '10000',
      boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
    });

    document.body.appendChild(notification);

    // Auto-remove after duration
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, duration);
  }

  // Get current filter value
  getCurrentFilter() {
    const filterInput = document.getElementById('filter-input');
    return filterInput ? filterInput.value : '';
  }

  // Clear filter
  clearFilter() {
    const filterInput = document.getElementById('filter-input');
    if (filterInput) {
      filterInput.value = '';
      this.emit('filterItems', { query: '' });
    }
  }

  // Restore filter input value from stored query
  restoreFilterInput(query) {
    const filterInput = document.getElementById('filter-input');
    if (filterInput && query) {
      filterInput.value = query;
    }
  }

  toggleView() {
    this.currentView = this.currentView === 'card' ? 'table' : 'card';
    const button = document.getElementById('toggle-view');

    // Set data attribute on body for CSS targeting
    document.body.setAttribute('data-vine-view', this.currentView);

    if (this.currentView === 'table') {
      button.innerHTML = '<span class="vine-btn-icon">🃏</span><span class="vine-btn-text">Cards</span>';
      this.showTableView();
    } else {
      button.innerHTML = '<span class="vine-btn-icon">📊</span><span class="vine-btn-text">Table</span>';
      this.showCardView();
    }
  }

  showTableView() {
    const grid = document.getElementById('vvp-items-grid');
    if (!grid) {
      return;
    }

    // Create or show table container
    let tableContainer = document.getElementById('vine-table-container');
    if (!tableContainer) {
      tableContainer = document.createElement('div');
      tableContainer.id = 'vine-table-container';
      tableContainer.className = 'vine-table-container';
      grid.parentNode.insertBefore(tableContainer, grid.nextSibling);
    }

    // Build table from grid items
    const items = Array.from(grid.querySelectorAll('.vvp-item-tile'));

    const tableHTML = this.buildTableHTML(items);
    tableContainer.innerHTML = tableHTML;

    // Attach event listeners to table actions
    this.attachTableEventListeners(tableContainer);
  }

  showCardView() {
    // CSS will handle the display via data-vine-view attribute
  }

  getAutopickSourceLabel(source) {
    switch (source) {
      case 'rule':
        return 'Rules';
      case 'llm':
        return 'AI';
      default:
        return '—';
    }
  }

  getAutopickScoreHtml(item) {
    const confidence = item.dataset.vineAutopickConfidence;
    const source = item.dataset.vineAutopickSource;

    if (!confidence) {
      return '<span class="vine-table-muted">—</span>';
    }

    return `<span class="vine-table-autopick vine-autopick-${confidence >= 90 ? 'high' : confidence >= 75 ? 'mid' : confidence >= 50 ? 'low' : 'min'}">
      ${confidence}%
      <span class="vine-table-autopick-source">${this.getAutopickSourceLabel(source)}</span>
    </span>`;
  }

  buildTableHTML(items) {
    const rows = items.map(item => {
      // Extract title and link
      const titleElement = item.querySelector('.vvp-item-product-title-container a');
      const title = titleElement?.textContent.trim() || 'N/A';
      const link = titleElement?.href || '#';

      // Extract image
      const image = item.querySelector('img')?.src || '';

      // Extract ETV - look for the tax value in the content
      let etv = 'N/A';
      const content = item.querySelector('.vvp-item-tile-content');
      if (content) {
        // Try to find ETV in various possible locations
        const etvElement = content.querySelector('.a-size-base.a-color-secondary') ||
          content.querySelector('[class*="tax"]') ||
          Array.from(content.querySelectorAll('span')).find(span =>
            span.textContent.includes('$') || span.textContent.includes('ETV')
          );
        if (etvElement) {
          etv = etvElement.textContent.trim();
        }
      }

      // Get item states
      const isSeen = item.classList.contains('vine-seen');
      const isBookmarked = item.classList.contains('vine-bookmarked');
      const isNew = item.classList.contains('vine-new-item');
      const itemId = item.dataset.vineItemId || '';
      const isHidden = item.style.display === 'none';
      const autopickScore = this.getAutopickScoreHtml(item);

      return `
        <tr class="vine-table-row ${isSeen ? 'vine-table-row-seen' : ''} ${isBookmarked ? 'vine-table-row-bookmarked' : ''} ${isNew ? 'vine-table-row-new' : ''}" 
            data-item-id="${itemId}" 
            style="${isHidden ? 'display: none;' : ''}">
          <td class="vine-table-cell vine-table-cell-image">
            <img src="${image}" alt="Product" class="vine-table-image">
          </td>
          <td class="vine-table-cell vine-table-cell-title">
            <a href="${link}" target="_blank" class="vine-table-link">${title}</a>
            ${isNew ? '<span class="vine-table-badge-new">NEW</span>' : ''}
          </td>
          <td class="vine-table-cell vine-table-cell-etv">${etv}</td>
          <td class="vine-table-cell vine-table-cell-score">${autopickScore}</td>
          <td class="vine-table-cell vine-table-cell-status">
            ${isSeen ? '<span class="vine-table-badge vine-table-badge-seen">✓ Seen</span>' : '<span class="vine-table-badge">Not Seen</span>'}
            ${isBookmarked ? '<span class="vine-table-badge vine-table-badge-bookmarked">⭐ Bookmarked</span>' : ''}
          </td>
          <td class="vine-table-cell vine-table-cell-actions">
            <button class="vine-table-btn vine-table-btn-seen" data-action="toggle-seen" data-item-id="${itemId}" title="${isSeen ? 'Mark as Unseen' : 'Mark as Seen'}">
              ${isSeen ? '👁️' : '👁️‍🗨️'}
            </button>
            <button class="vine-table-btn vine-table-btn-bookmark" data-action="toggle-bookmark" data-item-id="${itemId}" title="${isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}">
              ${isBookmarked ? '⭐' : '☆'}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <table class="vine-table">
        <thead class="vine-table-header">
          <tr>
            <th class="vine-table-header-cell">Image</th>
            <th class="vine-table-header-cell">Product Title</th>
            <th class="vine-table-header-cell">ETV</th>
            <th class="vine-table-header-cell">Score</th>
            <th class="vine-table-header-cell">Status</th>
            <th class="vine-table-header-cell">Actions</th>
          </tr>
        </thead>
        <tbody class="vine-table-body">
          ${rows}
        </tbody>
      </table>
    `;
  }

  attachTableEventListeners(tableContainer) {
    // Handle action buttons
    tableContainer.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const itemId = button.dataset.itemId;

      if (action === 'toggle-seen') {
        this.emit('toggleSeenFromTable', { itemId });
      } else if (action === 'toggle-bookmark') {
        this.emit('toggleBookmarkFromTable', { itemId });
      }
    });
  }

  // Update table row when item state changes
  updateTableRow(itemId, updates) {
    const tableContainer = document.getElementById('vine-table-container');
    if (!tableContainer || this.currentView !== 'table') return;

    const row = tableContainer.querySelector(`tr[data-item-id="${itemId}"]`);
    if (!row) return;

    if (updates.seen !== undefined) {
      row.classList.toggle('vine-table-row-seen', updates.seen);
      const statusCell = row.querySelector('.vine-table-cell-status');
      const seenBtn = row.querySelector('[data-action="toggle-seen"]');

      if (statusCell) {
        const seenBadge = statusCell.querySelector('.vine-table-badge-seen');
        if (updates.seen && !seenBadge) {
          statusCell.insertAdjacentHTML('afterbegin', '<span class="vine-table-badge vine-table-badge-seen">✓ Seen</span>');
        } else if (!updates.seen && seenBadge) {
          seenBadge.remove();
        }
      }

      if (seenBtn) {
        seenBtn.textContent = updates.seen ? '👁️' : '👁️‍🗨️';
        seenBtn.title = updates.seen ? 'Mark as Unseen' : 'Mark as Seen';
      }
    }

    if (updates.bookmarked !== undefined) {
      row.classList.toggle('vine-table-row-bookmarked', updates.bookmarked);
      const statusCell = row.querySelector('.vine-table-cell-status');
      const bookmarkBtn = row.querySelector('[data-action="toggle-bookmark"]');

      if (statusCell) {
        const bookmarkBadge = statusCell.querySelector('.vine-table-badge-bookmarked');
        if (updates.bookmarked && !bookmarkBadge) {
          statusCell.insertAdjacentHTML('beforeend', '<span class="vine-table-badge vine-table-badge-bookmarked">⭐ Bookmarked</span>');
        } else if (!updates.bookmarked && bookmarkBadge) {
          bookmarkBadge.remove();
        }
      }

      if (bookmarkBtn) {
        bookmarkBtn.textContent = updates.bookmarked ? '⭐' : '☆';
        bookmarkBtn.title = updates.bookmarked ? 'Remove Bookmark' : 'Add Bookmark';
      }
    }

    if (updates.visible !== undefined) {
      row.style.display = updates.visible ? '' : 'none';
    }
  }

  cleanup() {
    super.cleanup();
    if (this.controlPanel && this.controlPanel.parentNode) {
      this.controlPanel.parentNode.removeChild(this.controlPanel);
    }
    const tableContainer = document.getElementById('vine-table-container');
    if (tableContainer && tableContainer.parentNode) {
      tableContainer.parentNode.removeChild(tableContainer);
    }
  }
} 

// Enhanced Background Service Worker with ultra-aggressive persistence mechanisms
// This script uses multiple strategies to stay active and recover from inactivity

// Store settings in a persistent way
let settings = {
  enableHighlighting: true,
  highlightColor: 'yellow',
  ruccCodesToHighlight: [4, 5, 6, 7, 8, 9],
  /**
   * Filter for Hispanic labels. This determines which counties will display
   * a Hispanic percentage label next to the county name. Possible values
   * are:
   *   'all'   – show labels for all counties regardless of percentage.
   *   'lt10'  – only show labels when the percentage is less than 10%.
   *   'lt25'  – only show labels when the percentage is less than 25%.
   *   'lt50'  – only show labels when the percentage is less than 50%.
   * If undefined or unrecognized, defaults to 'all'.
   */
  hispanicFilter: 'all',
  /**
   * Track the last time the extension was active. Updated whenever settings
   * are applied or the service worker wakes up. This timestamp is persisted
   * via chrome.storage and sent to the popup for display.
   */
  lastActiveTimestamp: Date.now(),
  /**
   * Filter for Florida region labels. When a region is included in this
   * array, counties in that region will display a label next to the county
   * name (e.g. North, Central or South). By default all three regions are
   * enabled. The content script reads this setting to decide which labels
   * to inject.
   */
  regionFilters: ['North', 'Central', 'South']
};

// Constants for alarm timing
const MAIN_ALARM_NAME = 'keepAliveAlarm';
const BACKUP_ALARM_NAME = 'backupKeepAliveAlarm';
const RECOVERY_ALARM_NAME = 'recoveryAlarm';
const HEARTBEAT_ALARM_NAME = 'heartbeatAlarm';
const MAIN_ALARM_PERIOD_MINUTES = 2; // More frequent than the 5-minute timeout
const BACKUP_ALARM_PERIOD_MINUTES = 3; // Different timing to avoid synchronization issues
const HEARTBEAT_CHECK_SECONDS = 10; // Ultra-frequent heartbeat checks
const MAX_INACTIVE_MINUTES = 4; // Just under the 5-minute inactivity timeout

// Track alarm status
let alarmStatus = {
  mainAlarmLastFired: 0,
  backupAlarmLastFired: 0,
  heartbeatAlarmLastFired: 0,
  recoveryAttempts: 0
};

// Track active tabs
let activeTabs = [];

// Initialize the service worker
async function initializeServiceWorker() {
  console.log('[RUCC Highlighter] Service worker initializing');
  
  // Load saved settings
  try {
    const savedSettings = await chrome.storage.local.get('settings');
    if (savedSettings.settings) {
      settings = {...settings, ...savedSettings.settings};
      console.log('[RUCC Highlighter] Loaded saved settings:', settings);
    }
  } catch (error) {
    console.error('[RUCC Highlighter] Error loading settings:', error);
  }
  
  // Load saved alarm status
  try {
    const savedAlarmStatus = await chrome.storage.local.get('alarmStatus');
    if (savedAlarmStatus.alarmStatus) {
      alarmStatus = {...alarmStatus, ...savedAlarmStatus.alarmStatus};
      console.log('[RUCC Highlighter] Loaded alarm status:', alarmStatus);
    }
  } catch (error) {
    console.error('[RUCC Highlighter] Error loading alarm status:', error);
  }
  
  // Set up the keep-alive alarms
  setupKeepAliveAlarms();
  
  // Set up heartbeat check
  setInterval(heartbeatCheck, HEARTBEAT_CHECK_SECONDS * 1000);
  
  // Update the last active timestamp
  updateLastActiveTimestamp();
  
  // Check for existing alarms and their status
  checkExistingAlarms();
  
  // Register for periodic wake-up events
  registerPeriodicWakeup();
  
  // Find active tabs
  findActiveTabs();
}

// Set up the alarms to keep the service worker alive
function setupKeepAliveAlarms() {
  // Main alarm
  chrome.alarms.create(MAIN_ALARM_NAME, {
    periodInMinutes: MAIN_ALARM_PERIOD_MINUTES
  });
  
  // Backup alarm with different timing
  chrome.alarms.create(BACKUP_ALARM_NAME, {
    periodInMinutes: BACKUP_ALARM_PERIOD_MINUTES
  });
  
  // Recovery alarm for emergency wake-ups
  chrome.alarms.create(RECOVERY_ALARM_NAME, {
    periodInMinutes: 1 // Check every minute for recovery needs
  });
  
  // Heartbeat alarm for ultra-frequent checks
  chrome.alarms.create(HEARTBEAT_ALARM_NAME, {
    periodInMinutes: 0.5 // Check every 30 seconds
  });
  
  console.log(`[RUCC Highlighter] Created keep-alive alarms: main (${MAIN_ALARM_PERIOD_MINUTES}m), backup (${BACKUP_ALARM_PERIOD_MINUTES}m), recovery (1m), heartbeat (0.5m)`);
  
  // Save alarm creation time
  alarmStatus.lastSetup = Date.now();
  saveAlarmStatus();
}

// Check existing alarms and their status
async function checkExistingAlarms() {
  try {
    const alarms = await chrome.alarms.getAll();
    console.log(`[RUCC Highlighter] Found ${alarms.length} existing alarms:`, alarms);
    
    // Check if our alarms exist
    const mainAlarmExists = alarms.some(a => a.name === MAIN_ALARM_NAME);
    const backupAlarmExists = alarms.some(a => a.name === BACKUP_ALARM_NAME);
    const recoveryAlarmExists = alarms.some(a => a.name === RECOVERY_ALARM_NAME);
    const heartbeatAlarmExists = alarms.some(a => a.name === HEARTBEAT_ALARM_NAME);
    
    // Recreate any missing alarms
    if (!mainAlarmExists || !backupAlarmExists || !recoveryAlarmExists || !heartbeatAlarmExists) {
      console.log('[RUCC Highlighter] Some alarms are missing, recreating them');
      setupKeepAliveAlarms();
    }
  } catch (error) {
    console.error('[RUCC Highlighter] Error checking existing alarms:', error);
    // If there's an error, recreate the alarms to be safe
    setupKeepAliveAlarms();
  }
}

// Register for periodic wake-up events
function registerPeriodicWakeup() {
  // This is a placeholder for future Chrome APIs that might support better wake-up mechanisms
  // Currently, we rely on alarms, but this function can be updated when new APIs become available
  
  // For now, we'll use a combination of techniques to maximize wake-up chances
  
  // 1. Use storage events as potential wake-up triggers (more frequently)
  setInterval(() => {
    const wakeupKey = `wakeup_${Date.now()}`;
    chrome.storage.local.set({[wakeupKey]: true}).then(() => {
      setTimeout(() => {
        chrome.storage.local.remove(wakeupKey);
      }, 1000);
    });
  }, 30000); // Every 30 seconds
  
  console.log('[RUCC Highlighter] Registered additional wake-up mechanisms');
}

// Find active tabs that match our URL pattern
async function findActiveTabs() {
  try {
    const tabs = await chrome.tabs.query({url: '*://*.unitrustcrm.com/*'});
    
    if (tabs.length > 0) {
      console.log(`[RUCC Highlighter] Found ${tabs.length} active unitrustcrm tabs`);
      activeTabs = tabs.map(tab => tab.id);
      
      // Send a heartbeat message to each tab
      for (const tab of tabs) {
        try {
          chrome.tabs.sendMessage(tab.id, {
            action: 'heartbeat',
            settings: settings,
            source: 'initialization'
          }).catch(error => {
            console.log(`[RUCC Highlighter] Error sending heartbeat to tab ${tab.id}, will attempt reinjection:`, error);
            reinjectContentScripts(tab.id);
          });
        } catch (error) {
          console.error(`[RUCC Highlighter] Error in tab communication:`, error);
          reinjectContentScripts(tab.id);
        }
      }
    }
  } catch (error) {
    console.error('[RUCC Highlighter] Error finding active tabs:', error);
  }
}

// Handle the alarm events to keep the service worker alive
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MAIN_ALARM_NAME) {
    console.log('[RUCC Highlighter] Main keep-alive alarm fired');
    alarmStatus.mainAlarmLastFired = Date.now();
    performKeepAliveActions('main');
  }
  else if (alarm.name === BACKUP_ALARM_NAME) {
    console.log('[RUCC Highlighter] Backup keep-alive alarm fired');
    alarmStatus.backupAlarmLastFired = Date.now();
    performKeepAliveActions('backup');
  }
  else if (alarm.name === RECOVERY_ALARM_NAME) {
    console.log('[RUCC Highlighter] Recovery alarm fired');
    checkRecoveryNeeded();
  }
  else if (alarm.name === HEARTBEAT_ALARM_NAME) {
    console.log('[RUCC Highlighter] Heartbeat alarm fired');
    alarmStatus.heartbeatAlarmLastFired = Date.now();
    performHeartbeatActions();
  }
  
  // Save updated alarm status
  saveAlarmStatus();
});

// Check if recovery is needed
function checkRecoveryNeeded() {
  const now = Date.now();
  const mainAlarmAge = (now - alarmStatus.mainAlarmLastFired) / (1000 * 60);
  const backupAlarmAge = (now - alarmStatus.backupAlarmLastFired) / (1000 * 60);
  const heartbeatAlarmAge = (now - alarmStatus.heartbeatAlarmLastFired) / (1000 * 60);
  
  console.log(`[RUCC Highlighter] Recovery check: Main alarm last fired ${mainAlarmAge.toFixed(2)}m ago, backup ${backupAlarmAge.toFixed(2)}m ago, heartbeat ${heartbeatAlarmAge.toFixed(2)}m ago`);
  
  // If alarms haven't fired recently, we might need recovery
  if (mainAlarmAge > MAIN_ALARM_PERIOD_MINUTES * 1.5 || 
      backupAlarmAge > BACKUP_ALARM_PERIOD_MINUTES * 1.5 || 
      heartbeatAlarmAge > 0.75) {
    console.log('[RUCC Highlighter] Possible alarm failure detected, attempting recovery');
    alarmStatus.recoveryAttempts++;
    saveAlarmStatus();
    
    // Recreate the alarms
    setupKeepAliveAlarms();
    
    // Perform keep-alive actions
    performKeepAliveActions('recovery');
  }
}

// Save alarm status to storage
function saveAlarmStatus() {
  chrome.storage.local.set({alarmStatus: alarmStatus}).catch(error => {
    console.error('[RUCC Highlighter] Error saving alarm status:', error);
  });
}

// Perform heartbeat actions
function performHeartbeatActions() {
  // Update the last active timestamp
  updateLastActiveTimestamp();
  
  // Check active tabs
  checkActiveTabs();
}

// Check active tabs and send heartbeat
async function checkActiveTabs() {
  try {
    // First check existing tabs
    for (const tabId of activeTabs) {
      try {
        chrome.tabs.get(tabId).then(tab => {
          if (tab && tab.url && tab.url.includes('unitrustcrm.com')) {
            // Send heartbeat
            chrome.tabs.sendMessage(tabId, {
              action: 'heartbeat',
              settings: settings,
              source: 'heartbeat'
            }).catch(error => {
              console.log(`[RUCC Highlighter] Error sending heartbeat to tab ${tabId}:`, error);
            });
          }
        }).catch(() => {
          // Tab no longer exists, remove from active tabs
          activeTabs = activeTabs.filter(id => id !== tabId);
        });
      } catch (error) {
        console.error(`[RUCC Highlighter] Error checking tab ${tabId}:`, error);
      }
    }
    
    // Then look for new tabs
    const tabs = await chrome.tabs.query({url: '*://*.unitrustcrm.com/*'});
    
    for (const tab of tabs) {
      if (!activeTabs.includes(tab.id)) {
        // New tab found
        activeTabs.push(tab.id);
        console.log(`[RUCC Highlighter] New tab found: ${tab.id}`);
        
        // Send heartbeat
        chrome.tabs.sendMessage(tab.id, {
          action: 'heartbeat',
          settings: settings,
          source: 'heartbeat_new'
        }).catch(error => {
          console.log(`[RUCC Highlighter] Error sending heartbeat to new tab ${tab.id}, will attempt reinjection:`, error);
          reinjectContentScripts(tab.id);
        });
      }
    }
  } catch (error) {
    console.error('[RUCC Highlighter] Error in checkActiveTabs:', error);
  }
}

// Actions to perform when the keep-alive alarm fires
async function performKeepAliveActions(source = 'main') {
  // Update the last active timestamp
  updateLastActiveTimestamp();
  
  // Check if we need to refresh any active tabs
  try {
    const tabs = await chrome.tabs.query({url: '*://*.unitrustcrm.com/*'});
    
    if (tabs.length > 0) {
      console.log(`[RUCC Highlighter] Found ${tabs.length} active unitrustcrm tabs`);
      
      // Update active tabs list
      activeTabs = tabs.map(tab => tab.id);
      
      // Send a heartbeat message to each tab
      for (const tab of tabs) {
        try {
          chrome.tabs.sendMessage(tab.id, {
            action: 'heartbeat',
            settings: settings,
            source: source
          }).catch(error => {
            console.log(`[RUCC Highlighter] Error sending heartbeat to tab ${tab.id}, will attempt reinjection:`, error);
            reinjectContentScripts(tab.id);
          });
        } catch (error) {
          console.error(`[RUCC Highlighter] Error in tab communication:`, error);
          reinjectContentScripts(tab.id);
        }
      }
    }
  } catch (error) {
    console.error('[RUCC Highlighter] Error checking tabs:', error);
  }
  
  // Perform additional wake-up actions based on source
  if (source === 'recovery') {
    // More aggressive recovery actions
    try {
      // Force check all tabs, not just matching ones
      const allTabs = await chrome.tabs.query({});
      
      for (const tab of allTabs) {
        if (tab.url && tab.url.includes('unitrustcrm.com')) {
          console.log(`[RUCC Highlighter] Recovery: Checking tab ${tab.id} with URL ${tab.url}`);
          
          // Try to reinject scripts
          reinjectContentScripts(tab.id);
        }
      }
    } catch (error) {
      console.error('[RUCC Highlighter] Error in recovery tab check:', error);
    }
  }
}

// Reinject content scripts if they're not responding
async function reinjectContentScripts(tabId) {
  try {
    console.log(`[RUCC Highlighter] Attempting to reinject content scripts in tab ${tabId}`);
    
    // Execute the content script directly
    await chrome.scripting.executeScript({
      target: {tabId: tabId},
      files: ['js/county_data.js', 'js/content.js']
    });
    
    // Insert the CSS
    await chrome.scripting.insertCSS({
      target: {tabId: tabId},
      files: ['css/content.css']
    });
    
    console.log(`[RUCC Highlighter] Successfully reinjected scripts in tab ${tabId}`);
    
    // Send the current settings to the newly injected content script
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        action: 'updateSettings',
        settings: settings
      }).catch(error => {
        console.error(`[RUCC Highlighter] Error sending settings after reinjection:`, error);
      });
    }, 500);
  } catch (error) {
    console.error(`[RUCC Highlighter] Error reinjecting scripts:`, error);
  }
}

// Heartbeat check to ensure the service worker is still active
function heartbeatCheck() {
  const now = Date.now();
  const lastActive = settings.lastActiveTimestamp || 0;
  const inactiveTimeMinutes = (now - lastActive) / (1000 * 60);
  
  console.log(`[RUCC Highlighter] Heartbeat check: Inactive for ${inactiveTimeMinutes.toFixed(2)} minutes`);
  
  // If we've been inactive for too long, reset the alarms
  if (inactiveTimeMinutes > MAX_INACTIVE_MINUTES) {
    console.log('[RUCC Highlighter] Detected extended inactivity, resetting alarms');
    setupKeepAliveAlarms();
    updateLastActiveTimestamp();
    
    // Perform recovery actions
    performKeepAliveActions('heartbeat_recovery');
  }
  
  // Check alarm health
  checkExistingAlarms();
}

// Update the last active timestamp
function updateLastActiveTimestamp() {
  settings.lastActiveTimestamp = Date.now();
  
  // Save the updated settings
  chrome.storage.local.set({settings: settings}).catch(error => {
    console.error('[RUCC Highlighter] Error saving settings:', error);
  });
}

// Listen for messages from the popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Update the last active timestamp for any message
  updateLastActiveTimestamp();
  
  console.log('[RUCC Highlighter] Received message:', message);
  
  if (message.action === 'getSettings') {
    // Send the current settings and alarm status
    sendResponse({
      settings: settings,
      alarmStatus: getAlarmStatusSummary()
    });
  }
  else if (message.action === 'updateSettings') {
    // Update the settings
    settings = {...settings, ...message.settings};
    
    // Save the updated settings
    chrome.storage.local.set({settings: settings}).catch(error => {
      console.error('[RUCC Highlighter] Error saving settings:', error);
    });
    
    // Send the updated settings to all active tabs
    chrome.tabs.query({url: '*://*.unitrustcrm.com/*'}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'updateSettings',
          settings: settings
        }).catch(error => {
          console.log(`[RUCC Highlighter] Error sending settings update to tab ${tab.id}:`, error);
        });
      });
    });
    
    sendResponse({
      success: true, 
      settings: settings,
      alarmStatus: getAlarmStatusSummary()
    });
  }
  else if (message.action === 'forceHighlight') {
    // Force highlighting in the active tab
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'forceHighlight',
          settings: settings,
          timestamp: Date.now() // Add timestamp to ensure message uniqueness
        }).catch(error => {
          console.log(`[RUCC Highlighter] Error sending force highlight to tab ${tabs[0].id}, attempting reinjection:`, error);
          reinjectContentScripts(tabs[0].id);
          
          // Try again after reinjection
          setTimeout(() => {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'forceHighlight',
              settings: settings,
              timestamp: Date.now(),
              retry: true
            }).catch(error => {
              console.error(`[RUCC Highlighter] Error sending force highlight after reinjection:`, error);
            });
          }, 1000);
        });
      }
    });
    
    sendResponse({success: true});
  }
  else if (message.action === 'reloadExtension') {
    // Reload the extension in the active tab
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs.length > 0) {
        reinjectContentScripts(tabs[0].id);
      }
    });
    
    sendResponse({success: true});
  }
  else if (message.action === 'resetAlarms') {
    // Reset the alarms
    console.log('[RUCC Highlighter] Manually resetting alarms');
    
    // Clear existing alarms
    chrome.alarms.clearAll().then(() => {
      // Set up new alarms
      setupKeepAliveAlarms();
      
      // Reset recovery attempts counter
      alarmStatus.recoveryAttempts = 0;
      saveAlarmStatus();
      
      sendResponse({
        success: true,
        alarmStatus: getAlarmStatusSummary()
      });
    });
  }
  else if (message.action === 'forceRecovery') {
    // Force recovery of content scripts
    console.log('[RUCC Highlighter] Forcing recovery of content scripts');
    
    // Find all matching tabs
    chrome.tabs.query({url: '*://*.unitrustcrm.com/*'}, (tabs) => {
      if (tabs.length > 0) {
        tabs.forEach(tab => {
          reinjectContentScripts(tab.id);
        });
      }
    });
    
    sendResponse({success: true});
  }
  else if (message.action === 'contentScriptActive') {
    // Content script is reporting it's active
    console.log(`[RUCC Highlighter] Content script active in tab ${sender.tab?.id}`);
    
    // Add to active tabs if not already there
    if (sender.tab && !activeTabs.includes(sender.tab.id)) {
      activeTabs.push(sender.tab.id);
    }
    
    sendResponse({
      settings: settings,
      alarmStatus: getAlarmStatusSummary()
    });
  }
  else if (message.action === 'heartbeat') {
    // Respond to heartbeat to confirm service worker is active
    sendResponse({
      active: true,
      settings: settings,
      alarmStatus: getAlarmStatusSummary()
    });
  }
  
  // Return true to indicate we'll send a response asynchronously
  return true;
});

// Get a summary of alarm status for reporting
function getAlarmStatusSummary() {
  const now = Date.now();
  
  return {
    mainAlarmAge: ((now - alarmStatus.mainAlarmLastFired) / 1000).toFixed(1) + 's',
    backupAlarmAge: ((now - alarmStatus.backupAlarmLastFired) / 1000).toFixed(1) + 's',
    heartbeatAlarmAge: ((now - alarmStatus.heartbeatAlarmLastFired) / 1000).toFixed(1) + 's',
    recoveryAttempts: alarmStatus.recoveryAttempts,
    lastSetup: new Date(alarmStatus.lastSetup || now).toLocaleTimeString()
  };
}

// Listen for tab updates to inject content scripts when needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only proceed if the tab has completed loading and matches our URL pattern
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('unitrustcrm.com')) {
    console.log(`[RUCC Highlighter] Tab ${tabId} updated, sending current settings`);
    
    // Add to active tabs if not already there
    if (!activeTabs.includes(tabId)) {
      activeTabs.push(tabId);
    }
    
    // Send the current settings to the content script
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        action: 'updateSettings',
        settings: settings
      }).catch(error => {
        console.log(`[RUCC Highlighter] Error sending settings to updated tab ${tabId}, attempting reinjection:`, error);
        reinjectContentScripts(tabId);
      });
    }, 1000); // Give the content script time to initialize
  }
});

// Listen for tab removal to update active tabs list
chrome.tabs.onRemoved.addListener((tabId) => {
  // Remove from active tabs
  activeTabs = activeTabs.filter(id => id !== tabId);
  console.log(`[RUCC Highlighter] Tab ${tabId} removed, active tabs: ${activeTabs.join(', ')}`);
});

// Listen for installation or update events
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[RUCC Highlighter] Extension ${details.reason}:`, details);
  
  // Reset alarms on install or update
  setupKeepAliveAlarms();
  
  // Reset recovery attempts counter
  alarmStatus.recoveryAttempts = 0;
  saveAlarmStatus();
});

// Initialize the service worker
initializeServiceWorker();

// Log that the service worker has started
console.log('[RUCC Highlighter] Ultra-aggressive service worker started');

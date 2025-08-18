/* Enhanced popup script with improved Force Highlight functionality and visual feedback */

let backgroundConnected = false;
let lastHeartbeat = 0;
let autonomousMode = false;

// Initialize the popup
document.addEventListener('DOMContentLoaded', function() {
  // Set up event listeners
  document.getElementById('enable-highlighting').addEventListener('change', updateSettings);
  document.getElementById('rucc-4').addEventListener('change', updateSettings);
  document.getElementById('rucc-5').addEventListener('change', updateSettings);
  document.getElementById('rucc-6').addEventListener('change', updateSettings);
  document.getElementById('rucc-7').addEventListener('change', updateSettings);
  document.getElementById('rucc-8').addEventListener('change', updateSettings);
  document.getElementById('rucc-9').addEventListener('change', updateSettings);
  document.getElementById('color-yellow').addEventListener('change', updateSettings);
  document.getElementById('color-green').addEventListener('change', updateSettings);
  document.getElementById('color-blue').addEventListener('change', updateSettings);

  // Region filter checkboxes.  Updating these will trigger updateSettings() so
  // the Apply Settings button remains enabled/disabled appropriately.  Region
  // filters determine which Florida counties receive a region label.
  document.getElementById('region-north').addEventListener('change', updateSettings);
  document.getElementById('region-central').addEventListener('change', updateSettings);
  document.getElementById('region-south').addEventListener('change', updateSettings);

  // Hispanic filter radio buttons.  Changing the filter should enable the
  // Apply Settings button.  These listeners call updateSettings() so the
  // Apply button state is refreshed when the user selects a different
  // threshold.
  document.getElementById('hispanic-lt10').addEventListener('change', updateSettings);
  document.getElementById('hispanic-lt25').addEventListener('change', updateSettings);
  document.getElementById('hispanic-lt50').addEventListener('change', updateSettings);
  document.getElementById('hispanic-all').addEventListener('change', updateSettings);
  document.getElementById('force-highlight').addEventListener('click', forceHighlight);
  document.getElementById('reload-extension').addEventListener('click', reloadExtension);
  document.getElementById('apply-settings').addEventListener('click', applySettings);
  document.getElementById('advanced-options').addEventListener('click', toggleAdvancedOptions);
  document.getElementById('reset-alarms').addEventListener('click', resetAlarms);
  document.getElementById('force-recovery').addEventListener('click', forceRecovery);
  
  // Load current settings
  loadSettings();
  
  // Start heartbeat check
  startHeartbeatCheck();
  
  // Check content script status
  checkContentScriptStatus();
  
  // Add visual feedback to Force Highlight button
  enhanceForceHighlightButton();
});

// Enhance Force Highlight button with visual feedback
function enhanceForceHighlightButton() {
  const forceButton = document.getElementById('force-highlight');
  
  // Add hover effect
  forceButton.style.transition = 'all 0.3s ease';
  forceButton.addEventListener('mouseover', function() {
    this.style.backgroundColor = '#0056b3';
    this.style.transform = 'scale(1.05)';
  });
  
  forceButton.addEventListener('mouseout', function() {
    this.style.backgroundColor = '';
    this.style.transform = 'scale(1)';
  });
  
  // Add active effect
  forceButton.addEventListener('mousedown', function() {
    this.style.transform = 'scale(0.95)';
  });
  
  forceButton.addEventListener('mouseup', function() {
    this.style.transform = 'scale(1.05)';
  });
}

// Load settings from background script or local storage
async function loadSettings() {
  try {
    // First try to get settings from background script
    chrome.runtime.sendMessage({action: 'getSettings'}, function(response) {
      if (response && response.settings) {
        updateUI(response.settings);
        backgroundConnected = true;
        autonomousMode = false;
        updateStatus('active', 'Active');
        lastHeartbeat = Date.now();
        document.getElementById('heartbeat-indicator').classList.add('active');
        document.getElementById('worker-status').textContent = 'Running';
        document.getElementById('operation-mode').textContent = 'Connected';
        
        // Update alarm status if available
        if (response.alarmStatus) {
          updateAlarmStatus(response.alarmStatus);
        }
        
        // Format last active time
        const lastActive = new Date(response.settings.lastActiveTimestamp);
        document.getElementById('last-active').textContent = lastActive.toLocaleTimeString();
        
        // Hide error and warning messages
        document.getElementById('error-container').style.display = 'none';
        document.getElementById('warning-container').style.display = 'none';
      } else {
        // If background script doesn't respond, try local storage
        loadSettingsFromLocalStorage();
      }
    });
  } catch (error) {
    // If there's an error with the background script, try local storage
    loadSettingsFromLocalStorage();
  }
}

// Load settings from local storage as fallback
async function loadSettingsFromLocalStorage() {
  try {
    const localData = await chrome.storage.local.get('settings');
    if (localData.settings) {
      updateUI(localData.settings);
      backgroundConnected = false;
      autonomousMode = true;
      updateStatus('autonomous', 'Autonomous');
      document.getElementById('heartbeat-indicator').classList.add('warning');
      document.getElementById('worker-status').textContent = 'Inactive';
      document.getElementById('operation-mode').textContent = 'Autonomous';
      
      // Show warning message
      document.getElementById('warning-container').style.display = 'block';
      document.getElementById('warning-message').textContent = 'Warning: Running in autonomous mode (background service inactive)';
      
      // Hide error message
      document.getElementById('error-container').style.display = 'none';
    } else {
      // If no settings in local storage either, show error
      handleConnectionError();
    }
  } catch (error) {
    handleConnectionError();
  }
}

// Update UI with settings
function updateUI(settings) {
  document.getElementById('enable-highlighting').checked = settings.enableHighlighting;
  
  // Set RUCC code checkboxes
  const ruccCodes = settings.ruccCodesToHighlight || [4, 5, 6, 7, 8, 9];
  document.getElementById('rucc-4').checked = ruccCodes.includes(4);
  document.getElementById('rucc-5').checked = ruccCodes.includes(5);
  document.getElementById('rucc-6').checked = ruccCodes.includes(6);
  document.getElementById('rucc-7').checked = ruccCodes.includes(7);
  document.getElementById('rucc-8').checked = ruccCodes.includes(8);
  document.getElementById('rucc-9').checked = ruccCodes.includes(9);
  
  // Set highlight color
  const color = settings.highlightColor || 'yellow';
  document.getElementById(`color-${color}`).checked = true;

  // Set region filters.  If regionFilters is undefined (older settings), default
  // to all three regions.  Checkboxes reflect whether each region is included.
  const regionFilters = settings.regionFilters || ['North', 'Central', 'South'];
  document.getElementById('region-north').checked = regionFilters.includes('North');
  document.getElementById('region-central').checked = regionFilters.includes('Central');
  document.getElementById('region-south').checked = regionFilters.includes('South');

  // Set Hispanic filter radio buttons.  If hispanicFilter is undefined
  // (older settings), default to 'all'.  Each radio is checked based on
  // the current setting.
  const hispanicFilter = settings.hispanicFilter || 'all';
  document.getElementById('hispanic-lt10').checked = hispanicFilter === 'lt10';
  document.getElementById('hispanic-lt25').checked = hispanicFilter === 'lt25';
  document.getElementById('hispanic-lt50').checked = hispanicFilter === 'lt50';
  document.getElementById('hispanic-all').checked = hispanicFilter === 'all';
  
  // Update UI state based on highlighting enabled/disabled
  updateUIState();
}

// Update UI state based on settings
function updateUIState() {
  if (!document.getElementById('enable-highlighting').checked) {
    // Disable all checkboxes if highlighting is disabled
    document.querySelectorAll('.checkbox-item input').forEach(checkbox => {
      checkbox.disabled = true;
    });
    document.querySelectorAll('.color-option input').forEach(radio => {
      radio.disabled = true;
    });
  } else {
    // Enable all checkboxes if highlighting is enabled
    document.querySelectorAll('.checkbox-item input').forEach(checkbox => {
      checkbox.disabled = false;
    });
    document.querySelectorAll('.color-option input').forEach(radio => {
      radio.disabled = false;
    });
  }
}

// Update settings based on UI
function updateSettings() {
  // Update UI state
  updateUIState();
}

// Apply settings to background script and local storage
async function applySettings() {
  const enableHighlighting = document.getElementById('enable-highlighting').checked;
  
  // Get selected RUCC codes
  const ruccCodesToHighlight = [];
  if (document.getElementById('rucc-4').checked) ruccCodesToHighlight.push(4);
  if (document.getElementById('rucc-5').checked) ruccCodesToHighlight.push(5);
  if (document.getElementById('rucc-6').checked) ruccCodesToHighlight.push(6);
  if (document.getElementById('rucc-7').checked) ruccCodesToHighlight.push(7);
  if (document.getElementById('rucc-8').checked) ruccCodesToHighlight.push(8);
  if (document.getElementById('rucc-9').checked) ruccCodesToHighlight.push(9);
  
  // Get selected highlight color
  let highlightColor = 'yellow';
  if (document.getElementById('color-green').checked) highlightColor = 'green';
  if (document.getElementById('color-blue').checked) highlightColor = 'blue';

  // Get selected regions.  Regions control which Florida counties receive a region
  // label.  When a region checkbox is checked, that region's counties will be
  // labeled (North, Central or South).  If no regions are selected the content
  // script will skip adding any labels.
  const regionFilters = [];
  if (document.getElementById('region-north').checked) regionFilters.push('North');
  if (document.getElementById('region-central').checked) regionFilters.push('Central');
  if (document.getElementById('region-south').checked) regionFilters.push('South');
  
  // Create settings object
  // Determine the selected Hispanic filter.  Default to 'all' if none is
  // selected (should not occur since one radio is checked by default).
  let hispanicFilter = 'all';
  const hispanicRadios = document.querySelectorAll('input[name="hispanic-filter"]');
  hispanicRadios.forEach(radio => {
    if (radio.checked) {
      hispanicFilter = radio.value;
    }
  });

  // Create settings object including the Hispanic filter.  This value is
  // propagated to the background script and content script to control
  // which labels are displayed.
  const newSettings = {
    enableHighlighting,
    ruccCodesToHighlight,
    highlightColor,
    regionFilters,
    hispanicFilter,
    lastActiveTimestamp: Date.now()
  };
  
  // Log the settings being applied
  console.log('Applying settings:', newSettings);
  
  // Always save to local storage for backup
  try {
    await chrome.storage.local.set({settings: newSettings});
  } catch (error) {
    console.error('Error saving settings to local storage:', error);
  }
  
  // Try to send to background script if connected
  if (backgroundConnected) {
    try {
      chrome.runtime.sendMessage({
        action: 'updateSettings',
        settings: newSettings
      }, function(response) {
        if (response && response.success) {
          updateStatus('active', 'Settings Applied');
          backgroundConnected = true;
          autonomousMode = false;
          lastHeartbeat = Date.now();
          
          // Update alarm status if available
          if (response.alarmStatus) {
            updateAlarmStatus(response.alarmStatus);
          }
          
          // Hide error and warning messages
          document.getElementById('error-container').style.display = 'none';
          document.getElementById('warning-container').style.display = 'none';
          
          // Show temporary success message
          const statusElement = document.getElementById('status');
          const originalText = statusElement.textContent;
          const originalClass = statusElement.className;
          
          statusElement.textContent = 'Settings Applied';
          statusElement.className = 'status active';
          
          setTimeout(() => {
            statusElement.textContent = originalText;
            statusElement.className = originalClass;
          }, 2000);
        } else {
          // If background doesn't respond properly, enter autonomous mode
          enterAutonomousMode();
        }
      });
    } catch (error) {
      // If there's an error communicating with background, enter autonomous mode
      enterAutonomousMode();
    }
  } else {
    // Already in autonomous mode, apply settings directly to content script
    applySettingsToContentScript(newSettings);
  }
}

// Apply settings directly to content script in autonomous mode
function applySettingsToContentScript(settings) {
  try {
    // Query for active tabs matching our URL pattern
    chrome.tabs.query({url: '*://*.unitrustcrm.com/*'}, (tabs) => {
      if (tabs.length > 0) {
        // Send settings to each matching tab
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'updateSettings',
            settings: settings
          }).catch(error => {
            console.log(`Error sending settings to tab ${tab.id}:`, error);
          });
        });
      }
    });
    
    // Show success message
    updateStatus('autonomous', 'Settings Applied (Autonomous)');
    
    // Show temporary success message
    const statusElement = document.getElementById('status');
    const originalText = statusElement.textContent;
    const originalClass = statusElement.className;
    
    statusElement.textContent = 'Settings Applied (Autonomous)';
    statusElement.className = 'status autonomous';
    
    setTimeout(() => {
      statusElement.textContent = originalText;
      statusElement.className = originalClass;
    }, 2000);
  } catch (error) {
    console.error('Error applying settings in autonomous mode:', error);
  }
}

// Force highlight in active tab - COMPLETELY REBUILT
function forceHighlight() {
  // Show visual feedback immediately
  const forceButton = document.getElementById('force-highlight');
  const originalText = forceButton.textContent;
  const originalBg = forceButton.style.backgroundColor;
  
  // Change button appearance to show it's working
  forceButton.textContent = 'Applying...';
  forceButton.style.backgroundColor = '#28a745';
  
  // Create a success counter to track successful operations
  let successCounter = 0;
  
  try {
    // APPROACH 1: Try via background script
    if (backgroundConnected) {
      chrome.runtime.sendMessage({action: 'forceHighlight'}, function(response) {
        if (response && response.success) {
          successCounter++;
          updateStatus('active', 'Highlighting Forced');
          backgroundConnected = true;
          autonomousMode = false;
          lastHeartbeat = Date.now();
          
          // Hide error and warning messages
          document.getElementById('error-container').style.display = 'none';
          document.getElementById('warning-container').style.display = 'none';
        }
        
        // Continue with direct approach regardless of background success
        forceHighlightDirectly();
      });
    } else {
      // If not connected to background, force highlight directly
      forceHighlightDirectly();
    }
  } catch (error) {
    // If there's an error, force highlight directly
    console.error('Error in primary force highlight path:', error);
    forceHighlightDirectly();
  }
  
  // APPROACH 2: Direct communication with content scripts
  function forceHighlightDirectly() {
    try {
      // Query for all tabs that might match our pattern
      chrome.tabs.query({}, (tabs) => {
        const matchingTabs = tabs.filter(tab => 
          tab.url && tab.url.includes('unitrustcrm.com')
        );
        
        if (matchingTabs.length > 0) {
          console.log(`Found ${matchingTabs.length} matching tabs for direct highlighting`);
          
          // Send force highlight message to all matching tabs
          matchingTabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'forceHighlight',
              timestamp: Date.now() // Add timestamp to ensure message uniqueness
            }).then(response => {
              if (response && response.success) {
                successCounter++;
                console.log(`Successfully forced highlight in tab ${tab.id}`);
              }
            }).catch(error => {
              console.error(`Error sending force highlight to tab ${tab.id}:`, error);
              
              // APPROACH 3: If direct message fails, try reinjection
              tryReinjection(tab.id);
            });
          });
          
          updateStatus('autonomous', 'Highlighting Forced (Direct)');
        } else {
          // If no matching tabs found, show error
          document.getElementById('error-container').style.display = 'block';
          document.getElementById('error-message').textContent = 'No matching tabs found. Please navigate to unitrustcrm.com first.';
        }
      });
    } catch (error) {
      console.error('Error in direct force highlight:', error);
      
      // APPROACH 4: Last resort - try to get active tab and force highlight
      tryActiveTabFallback();
    }
  }
  
  // APPROACH 3: Try reinjection if direct communication fails
  function tryReinjection(tabId) {
    try {
      console.log(`Attempting reinjection for tab ${tabId}`);
      
      // Execute content script directly
      chrome.scripting.executeScript({
        target: {tabId: tabId},
        files: ['js/county_data.js', 'js/content.js']
      }).then(() => {
        // Insert CSS
        chrome.scripting.insertCSS({
          target: {tabId: tabId},
          files: ['css/content.css']
        }).then(() => {
          // Send force highlight message after a delay
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, {
              action: 'forceHighlight',
              timestamp: Date.now()
            }).then(response => {
              if (response && response.success) {
                successCounter++;
                console.log(`Successfully forced highlight after reinjection in tab ${tabId}`);
              }
            }).catch(error => {
              console.error(`Error sending force highlight after reinjection:`, error);
            });
          }, 500);
        });
      }).catch(error => {
        console.error(`Error in reinjection:`, error);
      });
    } catch (error) {
      console.error('Error in reinjection attempt:', error);
    }
  }
  
  // APPROACH 4: Last resort - try active tab
  function tryActiveTabFallback() {
    try {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs.length > 0) {
          const activeTab = tabs[0];
          console.log(`Trying last resort with active tab ${activeTab.id}`);
          
          // Try to send message directly
          chrome.tabs.sendMessage(activeTab.id, {
            action: 'forceHighlight',
            timestamp: Date.now(),
            lastResort: true
          }).catch(error => {
            console.error('Last resort attempt failed:', error);
          });
        }
      });
    } catch (error) {
      console.error('Error in active tab fallback:', error);
    }
  }
  
  // Restore button appearance after a delay
  setTimeout(() => {
    if (successCounter > 0) {
      forceButton.textContent = 'Success!';
      forceButton.style.backgroundColor = '#28a745';
      
      // Reset after showing success
      setTimeout(() => {
        forceButton.textContent = originalText;
        forceButton.style.backgroundColor = originalBg;
      }, 1500);
    } else {
      forceButton.textContent = 'Retry';
      forceButton.style.backgroundColor = '#dc3545';
      
      // Reset after showing failure
      setTimeout(() => {
        forceButton.textContent = originalText;
        forceButton.style.backgroundColor = originalBg;
      }, 3000);
    }
  }, 1000);
}

// Reload extension in active tab
function reloadExtension() {
  try {
    if (backgroundConnected) {
      // If connected to background, use it to reload extension
      chrome.runtime.sendMessage({action: 'reloadExtension'}, function(response) {
        if (response && response.success) {
          updateStatus('active', 'Extension Reloaded');
          backgroundConnected = true;
          autonomousMode = false;
          lastHeartbeat = Date.now();
          
          // Hide error and warning messages
          document.getElementById('error-container').style.display = 'none';
          document.getElementById('warning-container').style.display = 'none';
        } else {
          // If background doesn't respond properly, reload directly
          reloadExtensionDirectly();
        }
      });
    } else {
      // If not connected to background, reload directly
      reloadExtensionDirectly();
    }
  } catch (error) {
    // If there's an error, reload directly
    reloadExtensionDirectly();
  }
}

// Reload extension directly
function reloadExtensionDirectly() {
  try {
    // Query for active tab
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs.length > 0) {
        // Execute content script directly
        chrome.scripting.executeScript({
          target: {tabId: tabs[0].id},
          files: ['js/county_data.js', 'js/content.js']
        }).then(() => {
          // Insert CSS
          chrome.scripting.insertCSS({
            target: {tabId: tabs[0].id},
            files: ['css/content.css']
          }).then(() => {
            // Send current settings
            setTimeout(() => {
              chrome.storage.local.get('settings', (data) => {
                if (data.settings) {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'updateSettings',
                    settings: data.settings
                  }).catch(error => {
                    console.error('Error sending settings after direct reload:', error);
                  });
                }
              });
            }, 500);
          });
        });
      }
    });
    
    updateStatus('autonomous', 'Extension Reloaded (Autonomous)');
  } catch (error) {
    console.error('Error reloading extension directly:', error);
  }
}

// Reset alarms to keep service worker alive
function resetAlarms() {
  try {
    chrome.runtime.sendMessage({action: 'resetAlarms'}, function(response) {
      if (response && response.success) {
        updateStatus('active', 'Alarms Reset');
        backgroundConnected = true;
        autonomousMode = false;
        lastHeartbeat = Date.now();
        
        // Update alarm status if available
        if (response.alarmStatus) {
          updateAlarmStatus(response.alarmStatus);
        }
        
        // Hide error and warning messages
        document.getElementById('error-container').style.display = 'none';
        document.getElementById('warning-container').style.display = 'none';
      } else {
        // If background doesn't respond properly, show warning
        document.getElementById('warning-container').style.display = 'block';
        document.getElementById('warning-message').textContent = 'Warning: Could not reset alarms (background service inactive)';
      }
    });
  } catch (error) {
    console.error('Error resetting alarms:', error);
    
    // Show error message
    document.getElementById('error-container').style.display = 'block';
    document.getElementById('error-message').textContent = `Error: ${error.message}`;
  }
}

// Force recovery of content scripts
function forceRecovery() {
  try {
    if (backgroundConnected) {
      // If connected to background, use it to force recovery
      chrome.runtime.sendMessage({action: 'forceRecovery'}, function(response) {
        if (response && response.success) {
          updateStatus('active', 'Recovery Forced');
          backgroundConnected = true;
          autonomousMode = false;
          lastHeartbeat = Date.now();
          
          // Hide error and warning messages
          document.getElementById('error-container').style.display = 'none';
          document.getElementById('warning-container').style.display = 'none';
        } else {
          // If background doesn't respond properly, force recovery directly
          forceRecoveryDirectly();
        }
      });
    } else {
      // If not connected to background, force recovery directly
      forceRecoveryDirectly();
    }
  } catch (error) {
    // If there's an error, force recovery directly
    forceRecoveryDirectly();
  }
}

// Force recovery directly
function forceRecoveryDirectly() {
  try {
    // Query for all tabs that might match our pattern
    chrome.tabs.query({}, (tabs) => {
      const matchingTabs = tabs.filter(tab => 
        tab.url && tab.url.includes('unitrustcrm.com')
      );
      
      if (matchingTabs.length > 0) {
        console.log(`Found ${matchingTabs.length} matching tabs for recovery`);
        
        // Reinject scripts in all matching tabs
        matchingTabs.forEach(tab => {
          // Execute content script directly
          chrome.scripting.executeScript({
            target: {tabId: tab.id},
            files: ['js/county_data.js', 'js/content.js']
          }).then(() => {
            // Insert CSS
            chrome.scripting.insertCSS({
              target: {tabId: tab.id},
              files: ['css/content.css']
            }).then(() => {
              // Send current settings
              setTimeout(() => {
                chrome.storage.local.get('settings', (data) => {
                  if (data.settings) {
                    chrome.tabs.sendMessage(tab.id, {
                      action: 'updateSettings',
                      settings: data.settings
                    }).catch(error => {
                      console.error(`Error sending settings after recovery to tab ${tab.id}:`, error);
                    });
                  }
                });
              }, 500);
            });
          }).catch(error => {
            console.error(`Error reinjecting scripts for recovery in tab ${tab.id}:`, error);
          });
        });
      }
    });
    
    updateStatus('autonomous', 'Recovery Forced (Autonomous)');
  } catch (error) {
    console.error('Error forcing recovery directly:', error);
  }
}

// Enter autonomous mode
function enterAutonomousMode() {
  backgroundConnected = false;
  autonomousMode = true;
  updateStatus('autonomous', 'Autonomous');
  document.getElementById('heartbeat-indicator').classList.remove('active');
  document.getElementById('heartbeat-indicator').classList.add('warning');
  document.getElementById('worker-status').textContent = 'Inactive';
  document.getElementById('operation-mode').textContent = 'Autonomous';
  
  // Show warning message
  document.getElementById('warning-container').style.display = 'block';
  document.getElementById('warning-message').textContent = 'Warning: Running in autonomous mode (background service inactive)';
  
  // Hide error message
  document.getElementById('error-container').style.display = 'none';
}

// Handle connection error
function handleConnectionError() {
  backgroundConnected = false;
  autonomousMode = false;
  updateStatus('error', 'Error');
  document.getElementById('heartbeat-indicator').classList.remove('active');
  document.getElementById('heartbeat-indicator').classList.add('error');
  document.getElementById('worker-status').textContent = 'Error';
  document.getElementById('operation-mode').textContent = 'Disconnected';
  
  // Show error message
  document.getElementById('error-container').style.display = 'block';
  document.getElementById('error-message').textContent = 'Error: Could not connect to extension. Try reloading the page or reinstalling the extension.';
  
  // Hide warning message
  document.getElementById('warning-container').style.display = 'none';
}

// Update status display
function updateStatus(type, text) {
  const statusElement = document.getElementById('status');
  statusElement.textContent = text;
  statusElement.className = `status ${type}`;
}

// Update alarm status display
function updateAlarmStatus(status) {
  document.getElementById('main-alarm').textContent = status.mainAlarmAge || 'N/A';
  document.getElementById('backup-alarm').textContent = status.backupAlarmAge || 'N/A';
  document.getElementById('recovery-attempts').textContent = status.recoveryAttempts || '0';
  document.getElementById('last-setup').textContent = status.lastSetup || 'N/A';
}

// Start heartbeat check
function startHeartbeatCheck() {
  setInterval(() => {
    try {
      chrome.runtime.sendMessage({action: 'heartbeat'}, function(response) {
        if (response && response.active) {
          if (!backgroundConnected) {
            console.log('Reconnected to background script');
            loadSettings();
          }
          
          backgroundConnected = true;
          lastHeartbeat = Date.now();
          autonomousMode = false;
          document.getElementById('heartbeat-indicator').classList.remove('warning', 'error');
          document.getElementById('heartbeat-indicator').classList.add('active');
        } else {
          const timeSinceHeartbeat = (Date.now() - lastHeartbeat) / 1000;
          if (backgroundConnected && timeSinceHeartbeat > 5) {
            console.log(`Lost connection to background script (${timeSinceHeartbeat.toFixed(1)}s since last heartbeat)`);
            enterAutonomousMode();
          }
        }
      });
    } catch (error) {
      console.error('Error in heartbeat check:', error);
      
      const timeSinceHeartbeat = (Date.now() - lastHeartbeat) / 1000;
      if (backgroundConnected && timeSinceHeartbeat > 5) {
        console.log(`Lost connection to background script (${timeSinceHeartbeat.toFixed(1)}s since last heartbeat)`);
        enterAutonomousMode();
      }
    }
  }, 2000);
}

// Check content script status
function checkContentScriptStatus() {
  try {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'heartbeat'}, function(response) {
          if (response && response.active) {
            console.log('Content script is active');
            document.getElementById('content-status').textContent = 'Active';
            document.getElementById('content-status').className = 'status active';
            
            if (response.autonomousMode) {
              document.getElementById('content-mode').textContent = 'Autonomous';
              document.getElementById('content-mode').className = 'status warning';
            } else {
              document.getElementById('content-mode').textContent = 'Connected';
              document.getElementById('content-mode').className = 'status active';
            }
            
            // Show highlight count if available
            if (response.highlightCount !== undefined) {
              document.getElementById('highlight-count').textContent = response.highlightCount;
            }
            
            // Show last highlight time if available
            if (response.lastHighlightTime) {
              const lastHighlight = new Date(response.lastHighlightTime);
              document.getElementById('last-highlight').textContent = lastHighlight.toLocaleTimeString();
            }
          } else {
            console.log('Content script is not responding');
            document.getElementById('content-status').textContent = 'Inactive';
            document.getElementById('content-status').className = 'status error';
            document.getElementById('content-mode').textContent = 'Disconnected';
            document.getElementById('content-mode').className = 'status error';
          }
        });
      }
    });
  } catch (error) {
    console.error('Error checking content script status:', error);
    document.getElementById('content-status').textContent = 'Error';
    document.getElementById('content-status').className = 'status error';
    document.getElementById('content-mode').textContent = 'Error';
    document.getElementById('content-mode').className = 'status error';
  }
}

// Toggle advanced options
function toggleAdvancedOptions() {
  const advancedSection = document.getElementById('advanced-section');
  const advancedButton = document.getElementById('advanced-options');
  
  if (advancedSection.style.display === 'none' || !advancedSection.style.display) {
    advancedSection.style.display = 'block';
    advancedButton.textContent = 'Hide Advanced Options';
  } else {
    advancedSection.style.display = 'none';
    advancedButton.textContent = 'Show Advanced Options';
  }
}

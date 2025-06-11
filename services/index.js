/**
 * 服務模組導出
 */
const AutoRevealService = require('./autoRevealService');

// 單例實例
let autoRevealServiceInstance = null;

/**
 * 獲取自動揭示服務單例
 * @returns {AutoRevealService} 自動揭示服務實例
 */
function getAutoRevealService() {
  if (!autoRevealServiceInstance) {
    autoRevealServiceInstance = new AutoRevealService();
  }
  return autoRevealServiceInstance;
}

module.exports = {
  AutoRevealService,
  getAutoRevealService
};

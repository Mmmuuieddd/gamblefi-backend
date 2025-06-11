/**
 * WebSocket 連接管理器
 * 參考自 stickman-nft-backend
 */
const { ethers } = require('ethers');
const EventEmitter = require('events');

class CustomWebSocketManager extends EventEmitter {
  constructor(wsUrl, httpUrl) {
    super();
    this.wsUrl = wsUrl;
    this.httpUrl = httpUrl;
    this.wsProvider = null;
    this.httpProvider = null;
    this.isConnected = false;
    this.lastBlockTime = Date.now();
    this.connectionCheckInterval = null;
    this.reconnectTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  /**
   * 獲取 WebSocket 提供者
   * @returns {ethers.WebSocketProvider} WebSocket 提供者
   */
  getProvider() {
    return this.wsProvider;
  }

  /**
   * 獲取 HTTP 提供者
   * @returns {ethers.JsonRpcProvider} HTTP 提供者
   */
  getHttpProvider() {
    return this.httpProvider;
  }

  /**
   * 建立 WebSocket 連接
   * @returns {Promise<ethers.WebSocketProvider>} WebSocket 提供者
   */
  async connect() {
    if (this.wsProvider) {
      return this.wsProvider;
    }

    try {
      console.log(`初始化 WebSocket 連接: ${this.wsUrl}`);

      // 先清理可能存在的舊連接
      this._cleanupConnection();

      // 創建 WebSocket 提供者
      this.wsProvider = new ethers.WebSocketProvider(this.wsUrl);

      // 創建 HttpProvider 作為備用
      this.httpProvider = new ethers.JsonRpcProvider(this.httpUrl);
      
      console.log('等待 WebSocket 連接就緒...');
      
      // 等待連接就緒
      await this.wsProvider.ready;
      
      // 獲取並顯示網絡信息
      const network = await this.wsProvider.getNetwork();
      console.log(`連接到網絡: ${network.name}, Chain ID: ${network.chainId}`);
      
      // 檢查區塊信息
      const blockNumber = await this.wsProvider.getBlockNumber();
      console.log(`當前區塊高度: ${blockNumber}`);
      
      // 設置區塊事件監聽，用於連接健康檢查
      this.wsProvider.on('block', (blockNumber) => {
        this._handleNewBlock(blockNumber);
      });
      
      // 啟動連接監控
      this._startConnectionCheck();
      
      // 更新狀態並觸發事件
      this.isConnected = true;
      this.emit('connected', this.wsProvider);
      
      console.log('WebSocket 連接成功建立');
      return this.wsProvider;
    } catch (error) {
      console.error('建立 WebSocket 連接失敗:', error);
      this._handleReconnect();
      throw error;
    }
  }

  /**
   * 處理新區塊事件
   * @param {number} blockNumber 區塊號碼
   */
  _handleNewBlock(blockNumber) {
    // 更新最後收到區塊的時間
    this.lastBlockTime = Date.now();
    
    // 只在每10個區塊輸出一次日誌
    if (blockNumber % 10 === 0) {
      console.log(`收到新區塊通知: ${blockNumber}`);
    }
  }

  /**
   * 清理現有連接
   */
  _cleanupConnection() {
    // 清理 WebSocketProvider
    if (this.wsProvider) {
      try {
        // 移除所有事件監聽器
        // ethers.js v6 的 WebSocketProvider 不需要顯式關閉
        this.wsProvider.removeAllListeners();
      } catch (e) {
        console.warn('清理 WebSocketProvider 時出錯:', e.message);
      }
      this.wsProvider = null;
    }
    
    // 清理 HttpProvider
    this.httpProvider = null;
    
    // 清理計時器
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    this.isConnected = false;
  }

  /**
   * 開始連接狀態監控
   */
  _startConnectionCheck() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }
    
    this.lastBlockTime = Date.now();
    
    // 每30秒檢查一次連接狀態
    this.connectionCheckInterval = setInterval(() => {
      this._checkConnection();
    }, 30000);
  }

  /**
   * 檢查連接狀態
   */
  async _checkConnection() {
    if (!this.wsProvider) {
      this._handleReconnect();
      return;
    }
    
    try {
      // 檢查自上次區塊以來的時間
      const now = Date.now();
      const blockAge = now - this.lastBlockTime;
      
      // 如果超過2分鐘沒有收到新區塊，嘗試重新連接
      if (blockAge > 120000) {
        console.log('長時間未收到區塊更新，檢查連接...');
        
        // 檢查是否能獲取當前區塊
        const blockNumber = await this.wsProvider.getBlockNumber();
        console.log(`WebSocket 連接正常，當前區塊高度: ${blockNumber}`);
        
        // 更新最後區塊時間
        this.lastBlockTime = now;
      }
    } catch (error) {
      console.error('檢查連接狀態失敗，準備重連:', error.message);
      this._handleReconnect();
    }
  }

  /**
   * 處理重連邏輯
   */
  _handleReconnect() {
    if (this.reconnectTimeout) {
      return;
    }
    
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error(`已達到最大重連次數 ${this.maxReconnectAttempts}，停止重連`);
      return;
    }
    
    // 使用指數退避策略
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
    console.log(`將在 ${delay/1000} 秒後嘗試重新連接...`);
    
    this._cleanupConnection();
    
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      console.log('嘗試重新初始化 WebSocket 連接...');
      
      try {
        await this.connect();
        this.reconnectAttempts = 0;
        this.emit('reconnected', this.wsProvider);
        console.log('重連成功！');
      } catch (error) {
        console.error('重連失敗:', error.message);
        this._handleReconnect();
      }
    }, delay);
  }

  /**
   * 停止服務
   */
  stop() {
    this._cleanupConnection();
    console.log('WebSocket 管理器已停止');
  }
}

module.exports = CustomWebSocketManager;

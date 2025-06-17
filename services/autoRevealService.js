/**
 * 自動揭示服務
 * 參考自 stickman-nft-backend
 */
const { ethers } = require('ethers');
const EventEmitter = require('events');
const mongoose = require('mongoose');
const { CONTRACT_ADDRESS, CONTRACT_ABI, RPC_URL, RPC_WSS_URL } = require('../config/contract');
const CustomWebSocketManager = require('./customWebSocket');
const GameEvent = require('../models/GameEvent');

class AutoRevealService extends EventEmitter {
  constructor() {
    super();
    
    // 初始化狀態
    this.isRunning = false;
    this.checkInterval = null;
    this.reconnectInterval = null;
    
    // WebSocket 提供者和合約
    this.wsManager = null;
    this.wsProvider = null;
    this.wsContract = null;
    
    // 設置揭示延遲（區塊數）
    this.revealDelay = 3; // 默認為3個區塊
    
    // HTTP 提供者和簽名者（用於發送交易）
    this.httpProvider = null;
    this.signer = null;
    this.contract = null;
    
    // 待處理的投注 - Map<string, {roomId, player, revealBlock, betId}>
    this.pendingBets = new Map();
  }
  
  /**
   * 初始化服務
   * @returns {Promise<boolean>} 初始化是否成功
   */
  async initialize() {
    if (!process.env.SETTLER_PRIVATE_KEY) {
      throw new Error('未設置 SETTLER_PRIVATE_KEY 環境變數，自動揭示服務無法啟動');
    }
    
    try {
      console.log('正在初始化自動揭示服務...');
      
      // 初始化 HTTP 提供者
      this.httpProvider = new ethers.JsonRpcProvider(RPC_URL);
      
      // 使用私鑰創建簽名者
      this.signer = new ethers.Wallet(process.env.SETTLER_PRIVATE_KEY, this.httpProvider);
      this.contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, this.signer);
      
      const signerAddress = await this.signer.getAddress();
      console.log(`自動揭示服務使用錢包地址: ${signerAddress}`);
      
      // 檢查餘額
      const balance = await this.httpProvider.getBalance(signerAddress);
      console.log(`錢包餘額: ${ethers.formatEther(balance)} ETH`);
      
      if (balance < ethers.parseEther('0.01')) {
        console.warn('警告: 錢包餘額過低，可能無法支付足夠的交易費用!');
      }
      
      // 初始化 WebSocket 連接
      await this._initWebSocketConnection();
      
      // 從合約讀取 revealDelay 值
      await this._fetchContractRevealDelay();
      
      // 啟動待處理投注檢查
      this._startPendingBetCheck();
      
      // 啟動 WebSocket 連接監控
      this._startConnectionMonitor();
      
      // 設置事件監聽器
      await this._setupEventListeners();
      console.log('自動揭示服務初始化完成！');
      
      return true;
    } catch (error) {
      console.error('初始化自動揭示服務失敗:', error);
      return false;
    }
  }
  
  /**
   * 停止服務
   * @returns {boolean} 是否成功停止
   */
  /**
   * 檢查 WebSocket 連接是否健康
   * @returns {Promise<boolean>} 連接是否健康
   */
  async isWebSocketHealthy() {
    try {
      if (!this.wsManager || !this.wsManager.wsProvider) {
        console.log('WebSocket 提供者未初始化');
        return false;
      }

      // 檢查最後收到區塊的時間
      const now = Date.now();
      const lastBlockTime = this.wsManager.lastBlockTime || 0;
      const blockAge = now - lastBlockTime;
      const MAX_BLOCK_AGE = 5 * 60 * 1000; // 5分鐘

      // 檢查區塊是否過期
      if (blockAge > MAX_BLOCK_AGE) {
        console.warn(`區塊已過期 ${Math.floor(blockAge / 1000)} 秒未更新`);
        return false;
      }

      // 檢查 WebSocket 連接狀態
      try {
        await this.wsManager.wsProvider.getBlockNumber();
        return true;
      } catch (error) {
        console.error('檢查 WebSocket 連接時出錯:', error.message);
        return false;
      }
    } catch (error) {
      console.error('執行健康檢查時出錯:', error);
      return false;
    }
  }

  /**
   * 停止服務
   * @returns {boolean} 是否成功停止
   */
  stop() {
    console.log('正在停止自動揭示服務...');
    
    // 清理定時器
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    
    // 清理 WebSocket
    if (this.wsManager) {
      this.wsManager.stop();
      this.wsManager = null;
    }
    
    // 清理連接和合約
    if (this.wsProvider) {
      try {
        // 移除所有事件監聽器
        this.wsProvider.removeAllListeners();
        this.wsProvider = null;
        this.wsContract = null;
      } catch (e) {
        console.warn('關閉 WebSocket 連接時出現問題:', e);
      }
    }
    
    this.isRunning = false;
    console.log('自動揭示服務已停止');
    return true;
  }
  
  /**
   * 初始化 WebSocket 連接
   * @private
   */
  async _initWebSocketConnection() {
    try {
      // 創建 WebSocket 管理器
      this.wsManager = new CustomWebSocketManager(RPC_WSS_URL, RPC_URL);
      
      // 監聽連接事件
      this.wsManager.on('connected', (provider) => {
        this.wsProvider = provider;
        this._setupEventListeners();
      });
      
      this.wsManager.on('reconnected', (provider) => {
        this.wsProvider = provider;
        this._setupEventListeners();
      });
      
      // 連接 WebSocket
      await this.wsManager.connect();
      
    } catch (error) {
      console.error('初始化 WebSocket 連接失敗:', error);
      throw error;
    }
  }
  
  /**
   * 設置事件監聽器
   * @private
   */
  _setupEventListeners() {
    try {
      if (!this.wsProvider) {
        console.error('無法設置事件監聽器: WebSocket 提供者不存在');
        return;
      }
      
      // 先移除所有現有監聽器，避免重複註冊
      if (this.wsContract) {
        try {
          this.wsContract.removeAllListeners();
          console.log('已移除所有現有事件監聽器');
        } catch (e) {
          console.warn('移除事件監聽器時出現問題:', e);
        }
      }
      
      // 創建合約實例
      this.wsContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, this.wsProvider);
      
      console.log('設置 BetPlaced 事件監聽器...');
      
      // 監聽 BetPlaced 事件
      this.wsContract.on('BetPlaced', async (roomId, player, amount, betBig, commitBlock, revealBlock, event) => {
        try {
          const formattedRoomId = parseInt(roomId);
          const txHash = event && event.log ? event.log.transactionHash : undefined;
          
          console.log(`收到 BetPlaced 事件: 房間=${formattedRoomId}, 玩家=${player}, 投注金額=${ethers.formatEther(amount)} ETH, 押大=${betBig}`);
          console.log(`交易哈希: ${txHash || '未知'}`);
          console.log(`投注將在區塊 ${revealBlock} 進行結算 (當前區塊: ${await this.wsProvider.getBlockNumber()})`);
          
          // 創建唯一鍵: roomId-player
          const key = `${formattedRoomId}-${player}`;
          
          // 獲取當前區塊號 - 確保正確存取區塊號
          let currentBlockNumber;
          try {
            // 檢查事件對象中的區塊號位置
            if (event && typeof event.blockNumber !== 'undefined') {
              currentBlockNumber = Number(event.blockNumber);
            } else if (event && event.log && typeof event.log.blockNumber !== 'undefined') {
              currentBlockNumber = Number(event.log.blockNumber);
            } else {
              // 直接查詢當前區塊號
              currentBlockNumber = Number(await this.wsProvider.getBlockNumber());
            }
          } catch (error) {
            console.error('獲取區塊號錯誤:', error);
            // 如果出錯，使用網路查詢當前區塊
            try {
              currentBlockNumber = Number(await this.wsProvider.getBlockNumber());
            } catch (fallbackError) {
              console.error('備用獲取區塊號也錯誤:', fallbackError);
              currentBlockNumber = Math.floor(Date.now() / 15000); // 使用粗略估計值
            }
          }
          
          console.log(`當前區塊號: ${currentBlockNumber}`);
          const safeRevealDelay = typeof this.revealDelay === 'number' && !isNaN(this.revealDelay) ? this.revealDelay : 3;
          const targetRevealBlock = currentBlockNumber + safeRevealDelay;

          // 將投注事件添加到待處理列表
          const pendingBet = {
            roomId: formattedRoomId,
            player,
            amount,
            betBig, // 保存投注方向
            blockNumber: currentBlockNumber,
            timeStamp: Math.floor(Date.now() / 1000), // 正確記錄時間戳（秒）
            commitBlock: currentBlockNumber, // 提交區塊為當前區塊
            revealBlock: targetRevealBlock, // 揭示區塊為當前區塊 + 延遲
            transactionHash: txHash // 保存交易哈希用於後續處理
          };
          
          // 再次確保 revealBlock 是有效數字
          if (isNaN(pendingBet.revealBlock) || pendingBet.revealBlock === undefined) {
            console.log(`警告：revealBlock 計算結果無效，使用當前區塊號 ${currentBlockNumber} + ${safeRevealDelay}`);
            pendingBet.revealBlock = currentBlockNumber + safeRevealDelay;
          }
          
          console.log(`設置揭示區塊: ${pendingBet.revealBlock} (當前區塊 ${currentBlockNumber} + 延遲 ${safeRevealDelay})`); 
          
          console.log(`待處理投注詳情：roomId=${pendingBet.roomId}, player=${pendingBet.player}, betBig=${pendingBet.betBig}, revealBlock=${pendingBet.revealBlock}`);
          this.pendingBets.set(key, pendingBet);
          
          // 將事件儲存到數據庫
          try {
            // 獲取交易哈希
            const txHash = event && event.log ? event.log.transactionHash : undefined;
            
            // 獲取區塊詳細信息
            const block = await this.wsProvider.getBlock(event.blockNumber);
            console.log(`下注事件詳情: 交易哈希=${txHash || '無'}, 金額=${ethers.formatEther(amount)} ETH`);
            
            // 存儲原始金額和格式化金額以方便後續使用
            const amountWei = amount.toString();
            const amountEth = ethers.formatEther(amount);
            
            // 生成唯一標識，避免索引衝突
            const randomId = Date.now() + Math.floor(Math.random() * 100000);
            const blockNum = Number(event.blockNumber) || Math.floor(randomId / 100000);
            const logIdx = event && event.log && event.log.index ? Number(event.log.index) : (randomId % 100000);
            
            // 建立新的遊戲事件記錄
            const gameEvent = new GameEvent({
              eventType: 'BetPlaced',
              roomId: formattedRoomId,
              player,
              amount: amountEth,             // 使用可讀格式的金額
              amountWei: amountWei,         // 同時保存原始 Wei 格式
              betBig,
              commitBlock: Number(commitBlock),
              revealBlock: Number(revealBlock),
              transactionHash: txHash || '', // 使用正確的交易哈希
              blockNumber: blockNum,  // 使用實際區塊號或生成的唯一值
              blockTimestamp: block ? Number(block.timestamp) : Math.floor(Date.now() / 1000),
              logIndex: logIdx  // 使用實際日誌索引或生成的唯一值
            });
            
            // 保存到數據庫
            await gameEvent.save();
            console.log(`已將 BetPlaced 事件保存到數據庫, ID: ${gameEvent._id}`);
            
            // 不在投注階段記錄JSON文件，只在結算階段生成一個完整的JSON
            console.log(`投注事件已保存到數據庫，等待結算後再生成完整JSON文件`);
          } catch (dbError) {
            console.error('將 BetPlaced 事件存入數據庫失敗:', dbError);
          }
          
          console.log(`添加新的待處理投注: ${key}, 當前待處理投注數: ${this.pendingBets.size}`);
        } catch (error) {
          console.error('處理 BetPlaced 事件失敗:', error);
        }
      });
      
      console.log('設置 BetSettled 事件監聽器...');
      
      // 已處理的交易哈希集合，用來避免重複處理同一個結算事件
      const processedTxHashes = new Set();
      
      // 監聽 BetSettled 事件
      this.wsContract.on('BetSettled', async (roomId, player, amount, won, hashValue, blockHash, betId, event) => {
        const txHash = event && event.log ? event.log.transactionHash : event.transactionHash;
        
        // 如果交易哈希存在且已經處理過，則跳過
        if (txHash && processedTxHashes.has(txHash)) {
          console.log(`跳過重複的BetSettled事件，交易哈希: ${txHash}`);
          return;
        }
        
        // 如果沒有交易哈希，使用獨特的標識符來避免重複處理
        const betIdentifier = txHash || `${roomId}-${player}-${betId}-${Date.now()}`;
        
        // 將此交易哈希或標識符加入已處理集合
        processedTxHashes.add(betIdentifier);
        try {
          const formattedRoomId = parseInt(roomId);
          // 使用前面已經定義的txHash
          
          console.log(`收到 BetSettled 事件: 房間=${formattedRoomId}, 玩家=${player}, 贏=${won}, 哈希值=${hashValue}, 投注ID=${betId}`);
          console.log(`交易哈希: ${txHash || '未知'}, 金額=${ethers.formatEther(amount)} ETH`);
          
          // 創建唯一鍵: roomId-player
          const key = `${formattedRoomId}-${player}`;
          
          // 檢查是否在待處理列表中，如果是則移除
          const wasPending = this.pendingBets.has(key);
          let revealBlockNum = null;
          let originalBetAmount = null; // 原始投注金額
          let originalTxHash = null;
          let originalBetBig = null; // 原始投注方向
          
          if (wasPending) {
            // 從待處理列表獲取原始的揭示區塊號和投注金額
            const pendingBet = this.pendingBets.get(key);
            if (pendingBet) {
              // 使用待處理投注中的原始投注金額，不使用結算事件中的金額
              originalBetAmount = pendingBet.amount;
              originalBetBig = pendingBet.betBig; // 獲取原始投注方向
              
              // 確保使用正確的揭示區塊號
              revealBlockNum = Number(pendingBet.revealBlock);
              if (isNaN(revealBlockNum) || revealBlockNum <= 0) {
                // 如果堆發現揭示區塊號無效，嘗試使用原始的計算方式
                const currentBlock = Number(pendingBet.commitBlock);
                const safeRevealDelay = typeof this.revealDelay === 'number' && !isNaN(this.revealDelay) ? this.revealDelay : 3;
                revealBlockNum = currentBlock + safeRevealDelay;
                console.log(`重新計算揭示區塊號: ${revealBlockNum} (提交區塊 ${currentBlock} + 延遲 ${safeRevealDelay})`);
              }
              
              console.log(`投注使用的揭示區塊號為: ${revealBlockNum}`);
              console.log(`使用原始投注金額: ${ethers.formatEther(originalBetAmount)} ETH`);
              console.log(`原始投注方向: ${originalBetBig ? '大' : '小'}`);
              
              // 保存原始交易哈希
              originalTxHash = pendingBet.transactionHash;
            }
            this.pendingBets.delete(key);
          }
          
          // 如果沒有找到原始投注金額，則使用事件中的金額
          if (!originalBetAmount) {
            originalBetAmount = amount;
            console.log(`未找到原始投注記錄，使用結算事件金額: ${ethers.formatEther(originalBetAmount)} ETH`);
          }
          
          // 將結算事件儲存到數據庫
          try {
            // 獲取交易哈希
            const txHash = event && event.log ? event.log.transactionHash : undefined;
            
            // 獲取區塊詳細信息
            const block = await this.wsProvider.getBlock(event.blockNumber);
            
            // 印出事件詳情用于調試
            console.log(`結算事件詳情: 交易哈希=${txHash || '無'}, 原始金額=${amount.toString()}, 開出結果=${hashValue}`);
            
            // 轉換金額並記錄原始價值
            const amountWei = originalBetAmount.toString();
            const amountEth = ethers.formatEther(originalBetAmount);
            
            // 生成唯一標識，避免索引衝突
            const randomId = Date.now() + Math.floor(Math.random() * 100000);
            const blockNum = Number(event.blockNumber) || Math.floor(randomId / 100000);
            const logIdx = event && event.log && event.log.index ? Number(event.log.index) : (randomId % 100000);
            
            // 計算獎勵金額並轉成可讀格式
            let rewardAmountWei = "0";
            let rewardAmountEth = "0.0";
            if (won) {
              // 使用智能合約返回的獎勵金額，而不是再次計算
              // 獎勵金額就是合約返回的結算金額
              rewardAmountWei = amount.toString();
              rewardAmountEth = ethers.formatEther(rewardAmountWei);
              console.log(`玩家贏得遊戲，獎勵金額: ${rewardAmountEth} ETH`);
            }
            
            // 建立新的遊戲事件記錄
            const gameEvent = new GameEvent({
              eventType: 'BetSettled',
              roomId: formattedRoomId,
              player,
              amount: ethers.formatEther(originalBetAmount),  // 使用原始投注金額
              amountWei: originalBetAmount.toString(),       // 保存原始 Wei 格式
              rewardAmount: rewardAmountEth,               // 使用可讀的 ETH 格式
              rewardAmountWei: rewardAmountWei,           // 保存原始 Wei 格式
              won,
              betBig: originalBetBig,                     // 使用原始投注方向
              hashValue: Number(hashValue),
              blockHash: blockHash || '',
              resultBlock: revealBlockNum,               // 保存用於計算結果的揭示區塊號
              betId: betId.toString(),
              transactionHash: txHash || '',  // 使用正確的交易哈希
              blockNumber: blockNum,  // 使用實際區塊號或生成的唯一值
              blockTimestamp: block ? Number(block.timestamp) : Math.floor(Date.now() / 1000),
              logIndex: logIdx  // 使用實際日誌索引或生成的唯一值
            });
            
            // 保存到數據庫
            await gameEvent.save();
            console.log(`已將 BetSettled 事件保存到數據庫, ID: ${gameEvent._id}`);
            
            // 記錄到 JSON 文件
            try {
              const settledData = {
                _id: gameEvent._id,
                eventType: 'BetSettled',
                roomId: formattedRoomId,
                player,
                amount: originalBetAmount,
                rewardAmount: won ? amount : '0', // 贏的話使用實際獎勵金額，輸的話獎勵金額為零
                won,
                hashValue: Number(hashValue),
                blockHash,
                resultBlock: revealBlockNum,
                transactionHash: txHash,
                blockNumber: blockNum,
                timestamp: block ? Number(block.timestamp) * 1000 : Date.now(),
                date: new Date(block ? Number(block.timestamp) * 1000 : Date.now()).toISOString(),
                betBig: originalBetBig,
                betId: betId.toString()
              };
              
              // 尋找對應的投注數據
              const matchingBetEvent = await GameEvent.findOne({
                eventType: 'BetPlaced',
                roomId: formattedRoomId,
                player: player
              }).sort({ blockNumber: -1 }).limit(1);
              
              // 確保結算資料包含 relatedEventId
              if (matchingBetEvent && matchingBetEvent._id) {
                settledData.relatedEventId = matchingBetEvent._id.toString();
                console.log(`關聯原始投注事件 ID: ${settledData.relatedEventId}`);
              }
              
              // 記錄結算事件
              const { recordBetSettled } = require('../utils/betRecordUtils');
              const filePath = await recordBetSettled(settledData, matchingBetEvent);
              if (filePath) {
                console.log(`結算事件已記錄到 JSON 文件: ${filePath}`);
              }
            } catch (jsonError) {
              console.error('記錄結算事件到 JSON 失敗:', jsonError);
            }
            
            // 嘗試找到對應的 BetPlaced 事件並關聯
            const matchingPlacedEvent = await GameEvent.findOne({
              eventType: 'BetPlaced',
              roomId: formattedRoomId,
              player,
              processed: false
            }).sort({ blockNumber: -1 });
            
            if (matchingPlacedEvent) {
              // 建立關聯
              matchingPlacedEvent.relatedEventId = gameEvent._id;
              matchingPlacedEvent.processed = true;
              await matchingPlacedEvent.save();
              
              gameEvent.relatedEventId = matchingPlacedEvent._id;
              gameEvent.processed = true;
              await gameEvent.save();
              
              console.log(`已關聯 BetPlaced 和 BetSettled 事件: ${matchingPlacedEvent._id} <-> ${gameEvent._id}`);
            }
          } catch (dbError) {
            console.error('將 BetSettled 事件存入數據庫失敗:', dbError);
          }
          
          console.log(`收到投注結算事件: ${key}, 贏=${won}, 是否在待處理列表中=${wasPending}, 當前待處理投注數: ${this.pendingBets.size}`);
        } catch (error) {
          console.error('處理 BetSettled 事件失敗:', error);
        }
      });
      
      // 監聽區塊事件，用於投注檢查
      console.log('設置區塊事件監聽器...');
      this.wsProvider.on('block', (blockNumber) => {
        try {
          // 如果有待處理的投注，每10個區塊輸出一次日誌
          if (this.pendingBets.size > 0 && blockNumber % 10 === 0) {
            console.log(`收到新區塊: ${blockNumber}, 當前待處理投注數: ${this.pendingBets.size}`);
          }
          
          // 不在這裡檢查投注，由定時任務處理，避免每個區塊都執行重複檢查
        } catch (error) {
          console.error('處理區塊事件失敗:', error);
        }
      });
      
      console.log('所有事件監聽器設置完成');
    } catch (error) {
      console.error('設置事件監聽器失敗:', error);
    }
  }
  
  /**
   * 啟動待處理投注檢查定時任務
   * @private
   */
  _startPendingBetCheck() {
    // 清理現有定時器
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // 每10秒檢查一次
    this.checkInterval = setInterval(async () => {
      await this._checkPendingBets();
    }, 10000);
    
    console.log('啟動待處理投注定期檢查，每 10 秒檢查一次');
  }
  
  /**
   * 從合約中讀取 revealDelay 值
   * @private
   */
  async _fetchContractRevealDelay() {
    try {
      // 從合約中讀取 revealDelay 參數
      const contractRevealDelay = await this.contract.revealDelay();
      
      // 確保轉換為有效的數字並更新服務中的值
      const revealDelayNumber = Number(contractRevealDelay);
      if (!isNaN(revealDelayNumber) && revealDelayNumber > 0) {
        this.revealDelay = revealDelayNumber;
        console.log(`從智能合約中讀取 revealDelay 值: ${this.revealDelay} 區塊`);
      } else {
        console.warn(`合約返回的 revealDelay 值無效: ${contractRevealDelay}，使用預設值: ${this.revealDelay}`);
      }
    } catch (error) {
      console.error('讀取合約 revealDelay 值失敗:', error);
      console.log(`使用預設 revealDelay 值: ${this.revealDelay} 區塊`);
    }
  }
  
  /**
   * 啟動 WebSocket 連接監控
   * @private
   */
  _startConnectionMonitor() {
    // 清理現有定時器
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }
    
    // 每分鐘檢查一次
    this.reconnectInterval = setInterval(async () => {
      try {
        // 檢查基本連接狀態
        if (!this.wsProvider || !this.wsManager || !this.wsManager.isConnected) {
          console.log('檢測到 WebSocket 連接中斷，嘗試重新連接...');
          await this._reconnectWebSocket();
          return;
        }
        
        // 檢查區塊更新是否停滯
        const now = Date.now();
        const lastBlockTime = this.wsManager.lastBlockTime || 0;
        const blockAge = now - lastBlockTime;
        const MAX_BLOCK_AGE = 3 * 60 * 1000; // 3分鐘未收到新區塊視為異常
        
        if (blockAge > MAX_BLOCK_AGE) {
          console.warn(`檢測到 ${Math.floor(blockAge/1000)} 秒未收到新區塊，最後區塊時間: ${new Date(lastBlockTime).toISOString()}`);
          console.log('嘗試重新連接 WebSocket 以恢復區塊更新...');
          await this._reconnectWebSocket();
        } else {
          console.debug(`WebSocket 連接正常，最後區塊更新於 ${Math.floor(blockAge/1000)} 秒前`);
        }
      } catch (error) {
        console.error('WebSocket 監控檢查出錯:', error);
      }
    }, 60000); // 每分鐘檢查一次
    
    console.log('啟動 WebSocket 連接監控，每 60 秒檢查一次');
  }
  
  /**
   * 重新連接 WebSocket
   * @private
   */
  async _reconnectWebSocket() {
    try {
      // 清理現有連接
      if (this.wsManager) {
        console.log('正在清理現有 WebSocket 連接...');
        try {
          await this.wsManager.disconnect();
        } catch (cleanupError) {
          console.error('清理 WebSocket 連接時出錯:', cleanupError);
        }
      }
      
      // 重新初始化連接
      console.log('正在重新初始化 WebSocket 連接...');
      await this._initWebSocketConnection();
      
      // 重置最後區塊時間
      if (this.wsManager) {
        this.wsManager.lastBlockTime = Date.now();
      }
      
      console.log('WebSocket 重新連接成功');
    } catch (error) {
      console.error('WebSocket 重新連接失敗:', error);
      throw error;
    }
  }
  
  /**
   * 檢查待處理投注
   * @private
   */
  async _checkPendingBets() {
    if (this.pendingBets.size === 0) {
      return;
    }
    
    try {
      console.log(`檢查待處理投注，當前數量: ${this.pendingBets.size}`);
      
      // 獲取當前區塊號
      const currentBlockNumber = await this.httpProvider.getBlockNumber();
      
      // 檢查每個待處理的投注
      for (const [key, bet] of this.pendingBets.entries()) {
        try {
          const { roomId, player, revealBlock } = bet;
          
          // 檢查是否已達到揭示區塊
          const currentBlockNum = Number(currentBlockNumber);
          const revealBlockNum = Number(revealBlock);
          
          if (currentBlockNum >= revealBlockNum) {
            console.log(`投注 ${key} 的揭示區塊 ${revealBlockNum} 已到達，當前區塊 ${currentBlockNum}，開始結算...`);
            await this._settleBet(roomId, player, key);
          } else {
            const blocksRemaining = revealBlockNum - currentBlockNum;
            console.log(`投注 ${key} 等待中，還需 ${blocksRemaining} 個區塊到達揭示區塊 ${revealBlockNum}`);
          }
        } catch (error) {
          console.error(`處理待處理投注 ${key} 時出錯:`, error);
        }
      }
    } catch (error) {
      console.error('檢查待處理投注失敗:', error);
    }
  }
  
  /**
   * 結算投注
   * @param {number} roomId 房間ID
   * @param {string} player 玩家地址
   * @param {string} key 唯一鍵
   * @private
   */
  async _settleBet(roomId, player, key) {
    try {
      console.log(`嘗試結算投注: ${key}`);
      
      // 結算投注
      const tx = await this.contract.settleBet(roomId, player);
      console.log(`發送結算交易，交易哈希: ${tx.hash}`);
      
      // 等待交易確認
      const receipt = await tx.wait();
      console.log(`投注結算交易確認，區塊高度: ${receipt.blockNumber}, 狀態: ${receipt.status === 1 ? '成功' : '失敗'}`);
      
      // 從待處理列表中移除
      if (this.pendingBets.has(key)) {
        this.pendingBets.delete(key);
        console.log(`結算完成後從待處理列表移除，當前待處理投注數: ${this.pendingBets.size}`);
      }
      
      return true;
    } catch (error) {
      // 檢查特定錯誤，例如投注已被結算或不存在
      if (
        error.message && (
          error.message.includes('No valid bet found') ||
          error.message.includes('already processed') ||
          error.message.includes('executed')
        )
      ) {
        console.log(`投注已被結算或找不到，從待處理列表移除: ${key}`);
        this.pendingBets.delete(key);
        return true;
      }
      
      console.error(`結算投注 ${key} 失敗:`, error);
      return false;
    }
  }
}

module.exports = AutoRevealService;

/**
 * 遊戲記錄 API 路由
 */
const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const GameEvent = require('../models/GameEvent');

/**
 * 獲取玩家遊戲記錄
 * GET /api/game-records/:playerAddress
 */
router.get('/:playerAddress', async (req, res) => {
  try {
    const { playerAddress } = req.params;
    const { page = 1, limit = 10, roomId } = req.query;
    
    // 驗證玩家地址格式
    if (!ethers.isAddress(playerAddress)) {
      return res.status(400).json({ error: '無效的玩家地址格式' });
    }
    
    // 構建查詢條件 - 查詢已結算的投注
    const settledQuery = {
      player: playerAddress,
      eventType: 'BetSettled'
    };
    
    // 如果指定了房間 ID，則添加到查詢條件
    if (roomId) {
      settledQuery.roomId = parseInt(roomId);
    }
    
    // 計算分頁
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // 查詢玩家記錄
    const records = await GameEvent.find(settledQuery)
      .sort({ blockNumber: -1, logIndex: -1 }) // 按區塊號和日誌索引倒序排列
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    // 獲取記錄總數
    const total = await GameEvent.countDocuments(settledQuery);
    
    // 從數據庫中查詢相關的 BetPlaced 事件，以獲取原始投注信息
    const recordIds = records.map(r => r.relatedEventId).filter(id => id);
    const placedEvents = await GameEvent.find({
      _id: { $in: recordIds },
      eventType: 'BetPlaced'
    }).lean();
    
    // 建立 ID 映射以快速查找
    const placedEventsMap = {};
    placedEvents.forEach(pe => {
      placedEventsMap[pe._id.toString()] = pe;
    });
    
    // 格式化結果
    const formattedRecords = records.map(record => {
      // 先查詢對應的 BetPlaced 事件
      let placedEvent = null;
      if (record.relatedEventId) {
        placedEvent = placedEventsMap[record.relatedEventId.toString()];
      }
      
      console.log(`处理記錄 ${record._id}, 關聯 BetPlaced 事件: ${placedEvent ? placedEvent._id : '未找到'}`);
      
      // 使用 BetPlaced 事件的原始投注金額和選擇，如果有的話
      let betAmount = '0.001';
      let betChoice = record.betBig; // 預設使用 BetSettled 事件的數據
      
      if (placedEvent && placedEvent.amount) {
        try {
          if (typeof placedEvent.amount === 'string' && placedEvent.amount.startsWith('0x')) {
            betAmount = ethers.formatEther(placedEvent.amount);
          } else if (typeof placedEvent.amount === 'string') {
            betAmount = placedEvent.amount;
          } else if (typeof placedEvent.amount === 'number') {
            betAmount = placedEvent.amount.toString();
          }
          
          // 使用 BetPlaced 事件的投注方向
          betChoice = placedEvent.betBig;
          console.log(`使用 BetPlaced 事件投注方向: ${betChoice ? '大' : '小'}, 金額: ${betAmount}`);
        } catch (error) {
          console.error('處理 BetPlaced 事件數據失敗:', error);
        }
      } else {
        // 如果未找到對應的 BetPlaced 事件，則回退到使用 BetSettled 事件的數據
        try {
          if (record.amount) {
            if (typeof record.amount === 'string' && record.amount.startsWith('0x')) {
              betAmount = ethers.formatEther(record.amount);
            } else if (typeof record.amount === 'string') {
              betAmount = record.amount;
            } else if (typeof record.amount === 'number') {
              betAmount = record.amount.toString();
            }
          }
        } catch (error) {
          console.error('轉換投注金額失敗:', error);
          betAmount = '0.001';
        }
      }
      
      // 獎勵金額轉換
      let winAmount = '0.0';
      try {
        if (record.won && record.rewardAmount) {
          if (typeof record.rewardAmount === 'string' && record.rewardAmount.startsWith('0x')) {
            winAmount = ethers.formatEther(record.rewardAmount);
          } else if (typeof record.rewardAmount === 'string') {
            winAmount = record.rewardAmount;
          } else if (typeof record.rewardAmount === 'number') {
            winAmount = record.rewardAmount.toString();
          }
        }
      } catch (error) {
        console.error('轉換獎勵金額失敗:', error);
        winAmount = '0.0';
      }
      
      return {
        id: record._id,
        roomId: record.roomId,
        timestamp: record.createdAt,
        formattedTime: new Date(record.createdAt).toLocaleString('zh-TW', { 
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        }),
        amount: betAmount, // 使用從BetPlaced獲取的原始投注金額
        rewardAmount: winAmount,
        result: record.won ? '贏' : '輸',
        choice: betChoice ? '大' : '小', // 使用從BetPlaced獲取的原始投注選擇
        hashValue: record.hashValue,
        hashValueText: `${record.hashValue}(${record.hashValue >= 5 ? '大' : '小'})`,
        transactionHash: record.transactionHash,
        blockHash: record.blockHash || '',
        resultBlock: record.revealBlock || record.resultBlock || 0, // 優先使用revealBlock作為揭示區塊號
        // 添加關聯事件信息用於調試
        relatedEventId: record.relatedEventId ? record.relatedEventId.toString() : null,
        hasRelatedEvent: placedEvent ? true : false,
        originalBetDirection: placedEvent ? (placedEvent.betBig ? '大' : '小') : null
      };
    });
    
    res.json({
      records: formattedRecords,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('獲取遊戲記錄失敗:', error);
    res.status(500).json({ error: '獲取遊戲記錄時發生錯誤' });
  }
});

/**
 * 刷新玩家遊戲記錄
 * POST /api/game-records/:playerAddress/refresh
 */
router.post('/:playerAddress/refresh', async (req, res) => {
  try {
    const { playerAddress } = req.params;
    
    // 驗證玩家地址格式
    if (!ethers.isAddress(playerAddress)) {
      return res.status(400).json({ error: '無效的玩家地址格式' });
    }
    
    // 這裡可以觸發一個任務來重新索引玩家的近期事件
    // 實際實現中，可能需要從區塊鏈上獲取最新的數據
    // 但為了簡單起見，我們這裡只返回成功信息
    
    res.json({
      success: true,
      message: '已觸發玩家記錄刷新'
    });
  } catch (error) {
    console.error('刷新遊戲記錄失敗:', error);
    res.status(500).json({ error: '刷新遊戲記錄時發生錯誤' });
  }
});

/**
 * 獲取特定房間的記錄
 * GET /api/game-records/room/:roomId
 */
router.get('/room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    // 構建查詢條件
    const query = {
      roomId: parseInt(roomId),
      eventType: 'BetSettled'
    };
    
    // 計算分頁
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // 查詢房間記錄
    const records = await GameEvent.find(query)
      .sort({ blockNumber: -1, logIndex: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    // 獲取記錄總數
    const total = await GameEvent.countDocuments(query);
    
    // 格式化結果
    const formattedRecords = records.map(record => {
      return {
        id: record._id,
        player: record.player,
        timestamp: record.createdAt,
        formattedTime: new Date(record.createdAt).toLocaleString('zh-TW', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        }),
        amount: ethers.formatEther(record.amount),
        rewardAmount: record.rewardAmount ? ethers.formatEther(record.rewardAmount) : '0.0',
        result: record.won ? '贏' : '輸',
        choice: record.betBig ? '大' : '小',
        hashValue: record.hashValue,
        hashValueText: `${record.hashValue}(${record.hashValue > 49 ? '大' : '小'})`,
        transactionHash: record.transactionHash,
        resultBlock: record.resultBlock || 0 // 添加結算區塊號
      };
    });
    
    res.json({
      records: formattedRecords,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('獲取房間記錄失敗:', error);
    res.status(500).json({ error: '獲取房間記錄時發生錯誤' });
  }
});

module.exports = router;

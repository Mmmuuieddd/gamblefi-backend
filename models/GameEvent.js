/**
 * 遊戲事件模型
 * 用於記錄所有區塊鏈上的遊戲相關事件
 */
const mongoose = require('mongoose');

const gameEventSchema = new mongoose.Schema({
  // 事件類型：BetPlaced, BetSettled 等
  eventType: {
    type: String,
    required: true,
    index: true
  },
  
  // 房間ID
  roomId: {
    type: Number,
    required: true,
    index: true
  },
  
  // 玩家地址
  player: {
    type: String,
    required: true,
    index: true
  },
  
  // 投注金額 (以 wei 為單位的字符串)
  amount: {
    type: String,
    required: true
  },
  
  // 獎勵金額 (以 wei 為單位的字符串，BetSettled 事件)
  rewardAmount: {
    type: String,
    default: "0"
  },
  
  // 是否押大 (BetPlaced 事件)
  betBig: {
    type: Boolean,
    default: null
  },
  
  // 提交區塊號 (BetPlaced 事件)
  commitBlock: {
    type: Number,
    default: null
  },
  
  // 揭示區塊號 (BetPlaced 事件)
  revealBlock: {
    type: Number,
    default: null
  },
  
  // 是否獲勝 (BetSettled 事件)
  won: {
    type: Boolean,
    default: null
  },
  
  // 哈希值 (BetSettled 事件)
  hashValue: {
    type: Number,
    default: null
  },
  
  // 區塊哈希 (BetSettled 事件)
  blockHash: {
    type: String,
    default: null
  },
  
  // 結算區塊號 (實際用於計算結果的區塊號, BetSettled 事件)
  resultBlock: {
    type: Number,
    default: null
  },
  
  // 投注ID (BetSettled 事件)
  betId: {
    type: String,
    default: null,
    index: true
  },
  
  // 交易哈希
  transactionHash: {
    type: String,
    required: false,
    index: true
  },
  
  // 區塊號
  blockNumber: {
    type: Number,
    required: true,
    index: true
  },
  
  // 區塊時間戳
  blockTimestamp: {
    type: Number,
    default: null
  },
  
  // 日誌索引
  logIndex: {
    type: Number,
    required: true
  },
  
  // 是否已處理（用於標記已合併的 BetPlaced 和 BetSettled 事件）
  processed: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // 對應的事件（BetPlaced 事件對應的 BetSettled ID，或反之）
  relatedEventId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  
  // 事件創建時間
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// 創建複合索引
gameEventSchema.index({ roomId: 1, player: 1, eventType: 1 });
// 移除唯一約束，防止重複鍵錯誤
gameEventSchema.index({ blockNumber: 1, logIndex: 1 });
gameEventSchema.index({ player: 1, createdAt: -1 }); // 用於快速查詢玩家的遊戲記錄

// 虛擬屬性 - 玩家可閱讀的投注時間
gameEventSchema.virtual('formattedTime').get(function() {
  return this.createdAt.toLocaleString('zh-TW', { 
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
});

// 虛擬屬性 - 可讀的選擇
gameEventSchema.virtual('choiceText').get(function() {
  return this.betBig === true ? '大' : (this.betBig === false ? '小' : '未知');
});

// 虛擬屬性 - 可讀的結果
gameEventSchema.virtual('resultText').get(function() {
  return this.won === true ? '贏' : (this.won === false ? '輸' : '未知');
});

// 設置 toJSON 和 toObject 配置
gameEventSchema.set('toJSON', { virtuals: true });
gameEventSchema.set('toObject', { virtuals: true });

const GameEvent = mongoose.model('GameEvent', gameEventSchema);

module.exports = GameEvent;
